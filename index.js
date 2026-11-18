/**
 * dsh-task-board — Host half.
 *
 * 任务分发后，让智能体按需求自动生成「处理清单」与「交付清单」，
 * 并把当前进度、处理结果、交付产物集中记录到一块看板上：
 *   - 对话里：工具以 Markdown 输出清单（task_board_plan / update / show）；
 *   - 侧边栏：浏览器半身通过 /api/dsh-task-board/* 轮询展示进度。
 *
 * v1.1 修复：
 * - 用户会话里的原始需求会自动从 exec.agent.session 抓取，写进看板的 sessionDemand，
 *   不再只依赖智能体手填的 requirement（用户会话的需求未计入任务的问题）；
 * - 读取 ~/.dsh/storages/workspace.json 的 global.archivedSessionIds，
 *   按看板的 sessionId 判定归档，前端把归档任务单列一类（归档后仍显示进行中的问题）。
 *
 * v1.3 修复「记录延迟」：
 * - 不再只靠系统提示词让模型自觉调用 task_board_plan（模型常常几十分钟都不调用）。
 *   改为监听 agent/pre-step 等会话事件：会话一出现用户需求，插件就自动建草稿板，
 *   标题取需求首句，原文写入 sessionDemand，处理/交付清单先留空。
 * - 模型随后调用 task_board_plan 时，会复用同会话的草稿板填入清单，不重复建板。
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

export const name = 'dsh-task-board';

export const inject = ['connection', 'tools', 'systemPrompt', 'commands'];

const STORE_UNIT = 'dsh_task_board';
const STORE_VERSION = 1;
const BOARD_TABLE = 'boards';

const STATUS_ITEM = new Set(['pending', 'doing', 'done', 'blocked']);
const STATUS_BOARD = new Set(['planning', 'working', 'done', 'blocked']);
const TYPE_TO_ITEM = { processing: 'processing', delivery: 'delivery' };

const LIMITS = {
  title: 160,
  requirement: 12000,
  detail: 4000,
  spec: 4000,
  result: 6000,
  artifact: 4000,
  items: 80,
};

/** 产物预览：可直接内联展示的文件类型。 */
const ARTIFACT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};
const ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
const TEXT_MAX_BYTES = 1024 * 1024;
const TEXT_PREVIEW_CHARS = 200000;
const DIR_LIST_LIMIT = 200;
const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
  '.html', '.htm', '.css', '.scss', '.less', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.sql', '.xml', '.csv', '.tsv', '.log',
  '.env', '.vue', '.svelte', '.gitignore', '.editorconfig', '.lock',
]);

const LABEL = {
  pending: '待处理',
  doing: '进行中',
  done: '已完成',
  blocked: '受阻',
  planning: '规划中',
  working: '进行中',
  archived: '已归档',
  processing: '处理清单',
  delivery: '交付清单',
};

const PROMPT_TEXT = [
  '## 任务看板（处理清单 / 交付清单）',
  '本会话安装了 dsh-task-board 插件，用于让用户随时看到任务进度、要处理什么、处理结果和产物。',
  '请遵守以下工作流（不需要用户输入任何命令）：',
  '1. 当用户分发任务、委派子任务，或给出一个明确需求/目标后，在动手之前先调用 task_board_plan：',
  '   title 写一句话任务名，requirement 写整理后的目标与范围，processing 写要处理的事项（title/detail/owner），',
  '   delivery 写要交付的产物（title/spec）。两份清单要根据需求具体、可验收，不要写空话。',
  '   会话里用户的原始需求会被插件自动抓取并记录到看板，无需逐字重复，但 requirement 不能省略。',
  '2. 执行过程中，每完成或推进一项，就用 task_board_update 更新该项的 status、result（处理结果）、artifact（产物路径/链接/文件名）。',
  '   开始一项时把 status 设为 doing；受阻设为 blocked 并在 result 写清原因。',
  '3. 需要临时补一项时调用 task_board_add；整个任务收尾时把 board status 设为 done。',
  '4. 用户问「进度如何 / 做了什么 / 交付了什么」时，先调用 task_board_show 读取真实看板再回答，',
  '   不要凭记忆编造进度；回答里直接引用清单里的状态、处理结果和产物。',
  '5. 每个交付项在真正产出文件/链接之前不得标记 done，只能标 doing 或 pending。',
  '6. 任务所在会话被归档后，该任务会自动进入左侧栏「归档」列表，不再计入进行中；不要因为它消失就重建看板。',
].join('\n');

function ok(value) {
  return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } });
}

function fail(code, message) {
  return Response.json({ ok: false, error: { code, message } }, { headers: { 'cache-control': 'no-store' } });
}

function str(value, limit, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function clampStatus(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function now() {
  return Date.now();
}

function textOf(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** 会话 id 归一化：workspace.json 用 session-<uuid>，session.id 可能是带前缀或裸 uuid。 */
function normSid(value) {
  return String(value || '').replace(/^session-/, '').trim();
}

/** 产物字符串解析：取第一行，识别 URL；本地路径原样交给 resolveArtifact。 */
function extractArtifact(raw) {
  const firstLine = String(raw || '').trim().split(/\r?\n/)[0] || '';
  const trimmed = firstLine.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed.split(/\s+/)[0], path: '' };
  }
  return { url: '', path: trimmed.replace(/^file:\/\//i, '') };
}

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
}

function isAbsoluteLike(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function makeItem(raw, kind, index) {
  const src = raw && typeof raw === 'object' ? raw : { title: String(raw ?? '') };
  const title = str(src.title, LIMITS.title, '');
  if (!title) return null;
  return {
    id: typeof src.id === 'string' && src.id.trim() ? src.id.trim() : `${kind === 'processing' ? 'p' : 'd'}${index + 1}`,
    title,
    detail: kind === 'processing' ? str(src.detail, LIMITS.detail) : str(src.spec, LIMITS.spec),
    owner: kind === 'processing' ? str(src.owner, 80) : '',
    status: clampStatus(src.status, STATUS_ITEM, 'pending'),
    result: str(src.result, LIMITS.result),
    artifact: str(src.artifact, LIMITS.artifact),
    updatedAt: Number.isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : now(),
  };
}

function normalizeItems(input, kind) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (let i = 0; i < input.length && out.length < LIMITS.items; i += 1) {
    const item = makeItem(input[i], kind, i);
    if (item) out.push(item);
  }
  return out;
}

function progressOf(board) {
  const items = [...(board.processing || []), ...(board.delivery || [])];
  const done = items.filter((item) => item.status === 'done').length;
  const doing = items.filter((item) => item.status === 'doing').length;
  const blocked = items.filter((item) => item.status === 'blocked').length;
  return {
    total: items.length,
    done,
    doing,
    blocked,
    percent: items.length ? Math.round((done / items.length) * 100) : 0,
  };
}

function deriveBoardStatus(board) {
  const items = [...(board.processing || []), ...(board.delivery || [])];
  if (!items.length) return board.status === 'done' ? 'done' : 'planning';
  if (board.status === 'done') return 'done';
  if (items.some((item) => item.status === 'blocked')) return 'blocked';
  if (items.every((item) => item.status === 'done')) return 'done';
  if (items.some((item) => item.status !== 'pending')) return 'working';
  return 'planning';
}

function publicBoard(board, archivedSessions) {
  const progress = progressOf(board);
  const sid = normSid(board.sessionId);
  return {
    id: board.id,
    title: board.title,
    requirement: board.requirement || '',
    sessionDemand: board.sessionDemand || '',
    status: deriveBoardStatus(board),
    archived: Boolean(sid && archivedSessions && archivedSessions.has(sid)),
    processing: (board.processing || []).map((item) => ({ ...item })),
    delivery: (board.delivery || []).map((item) => ({ ...item })),
    progress,
    sessionId: board.sessionId || '',
    cwd: board.cwd || '',
    createdAt: board.createdAt || 0,
    updatedAt: board.updatedAt || 0,
  };
}

function renderBoardMarkdown(board, archivedSessions) {
  const view = publicBoard(board, archivedSessions);
  const lines = [
    `# 任务看板：${view.title}`,
    `状态：${view.archived ? '已归档 · ' : ''}${LABEL[view.status] || view.status} · 进度：${view.progress.done}/${view.progress.total}（${view.progress.percent}%）`,
  ];
  if (view.requirement) lines.push('', '## 需求', view.requirement);
  if (view.sessionDemand) lines.push('', '## 用户会话原始需求', view.sessionDemand);
  for (const kind of ['processing', 'delivery']) {
    const items = view[kind];
    lines.push('', `## ${LABEL[kind]}（${items.length}）`);
    if (!items.length) {
      lines.push('- （空）');
      continue;
    }
    items.forEach((item, i) => {
      lines.push(`${i + 1}. [${LABEL[item.status] || item.status}] ${item.title}`);
      if (item.owner) lines.push(`   - 负责人：${item.owner}`);
      if (item.detail) lines.push(`   - ${kind === 'processing' ? '要点' : '交付标准'}：${item.detail}`);
      if (item.result) lines.push(`   - 处理结果：${item.result}`);
      if (item.artifact) lines.push(`   - 产物：${item.artifact}`);
    });
  }
  return lines.join('\n');
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console;
  const boards = new Map();
  let store = null;
  let storeReady = null;
  let disposed = false;
  let archivedSessions = new Set();
  // v1.3：每个会话只自动建一次草稿板，避免 pre-step 多次触发重复建板。
  const autoBoarded = new Set();

  const maxBoards = Number.isFinite(config.maxBoards) && config.maxBoards > 0 ? Math.floor(config.maxBoards) : 200;
  const archivePollMs = Number.isFinite(config.archivePollMs) && config.archivePollMs >= 1000 ? config.archivePollMs : 4000;

  function dshHome(...parts) {
    try {
      const svc = ctx.get('dshHomePath');
      if (typeof svc === 'function') return String(svc(...parts));
    } catch {
      /* 落到 homedir 兜底 */
    }
    return resolve(homedir(), '.dsh', ...parts);
  }

  /** 从 DSH 的 workspace.json 读取归档会话 id（归一化后比较）。 */
  async function refreshArchived() {
    try {
      const text = await readFile(dshHome('storages', 'workspace.json'), 'utf8');
      const data = JSON.parse(text);
      const ids = data && data.global && Array.isArray(data.global.archivedSessionIds) ? data.global.archivedSessionIds : [];
      archivedSessions = new Set(ids.map(normSid).filter(Boolean));
    } catch {
      // 读不到就保留上一次结果，不让插件因文件暂时不可用而误判。
    }
  }

  /** 从当前会话抓用户原始需求 + sessionId + 会话工作目录。 */
  async function captureSession(exec) {
    const session = exec && exec.agent && exec.agent.session;
    const sessionId = session && typeof session.id === 'string' ? session.id : '';
    let cwd = '';
    if (session && typeof session.cwd === 'string' && session.cwd.trim()) cwd = session.cwd.trim();
    const texts = [];
    if (session && typeof session.snapshotEvents === 'function') {
      try {
        for (const event of session.snapshotEvents(0)) {
          if (event && event.type === 'user/message') {
            let t = textOf(event.data && event.data.content)
            if (!t) continue
            // 丢掉注入的 system-reminder / 时间戳外壳，只留用户真正说的话
            t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
            if (!t || t.startsWith('/')) continue
            if (/^Time sampled while preparing turn/m.test(t)) continue
            texts.push(t)
          }
        }
      } catch {
        /* 会话事件不可读时落到投影缓存兜底 */
      }
    }
    let demand = '';
    if (texts.length) {
      demand = texts.slice(-5).join('\n\n---\n\n');
    }
    if ((!demand || !cwd) && sessionId) {
      const norm = normSid(sessionId);
      for (const name of [sessionId, `session-${norm}`, norm]) {
        try {
          const text = await readFile(dshHome('storages', 'session_projcache', 'sessions', `${name}.json`), 'utf8');
          const rec = JSON.parse(text)?.record;
          const rows = rec && rec.rows;
          const title = rows && rows.title && rows.title.val;
          const turns = rows && rows.turnOutline && rows.turnOutline.val && rows.turnOutline.val.turns;
          const prompts = Array.isArray(turns) ? turns.map((turn) => turn && turn.prompt).filter(Boolean) : [];
          if (!demand) {
            const merged = [title, ...prompts].filter(Boolean);
            if (merged.length) demand = merged.slice(-5).join('\n\n---\n\n');
          }
          if (!cwd) {
            const identityCwd = rec && rec.identity && typeof rec.identity.cwd === 'string' ? rec.identity.cwd.trim() : '';
            if (identityCwd) cwd = identityCwd;
          }
          if (demand && cwd) break;
        } catch {
          /* 试下一个文件名 */
        }
      }
    }
    if (demand.length > LIMITS.requirement) demand = `${demand.slice(0, LIMITS.requirement)}…`;
    return { sessionId, sessionDemand: demand, cwd };
  }

  /**
   * v1.3 从用户原始需求里挑一个简短标题：取第一行有效文本，去掉常见前缀与 markdown 噪声。
   */
  function titleFromDemand(demand) {
    const firstLine = String(demand || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^(time sampled|browser time zone|elapsed since)/i.test(line)) || '';
    const clean = firstLine
      .replace(/^<[^>]+>\s*/g, '')
      .replace(/^[-*#>\d.\s]+/, '')
      .replace(/[*_`]/g, '')
      .trim();
    if (!clean) return '新任务';
    const short = clean.length > LIMITS.title ? `${clean.slice(0, LIMITS.title)}…` : clean;
    return short;
  }

  /**
   * v1.3 自动建草稿板：会话出现用户需求且该会话尚无关联看板时调用。
   * 清单留空（等模型后续调用 update/add 填充），保证「需求一出现就可见」。
   * 返回新建的 board，若已存在则复用现有 board。
   */
  async function ensureAutoBoard(exec) {
    const session = exec && exec.agent && exec.agent.session;
    const sessionId = session && typeof session.id === 'string' ? session.id : '';
    const norm = normSid(sessionId);
    if (!norm || autoBoarded.has(norm)) return null;
    // 已有该会话的看板（包括手工建的）就登记并复用，不重复创建。
    const existing = [...boards.values()].find((b) => normSid(b.sessionId) === norm);
    if (existing) {
      autoBoarded.add(norm);
      return existing;
    }
    // 存储可能还在异步恢复中；建板前等它就绪，避免落盘丢失。
    try { if (storeReady) await storeReady; } catch { /* 存储不可用也继续，至少内存可见 */ }
    const captured = await captureSession(exec);
    const demand = captured.sessionDemand;
    if (!demand || !demand.trim()) return null; // 还没有有效用户需求，等下一次事件
    autoBoarded.add(norm);
    const board = {
      id: randomUUID(),
      title: titleFromDemand(demand),
      requirement: '',
      sessionDemand: demand,
      status: 'planning',
      processing: [],
      delivery: [],
      sessionId: captured.sessionId || sessionId,
      cwd: captured.cwd || (typeof config.cwd === 'string' ? config.cwd.trim() : ''),
      createdAt: now(),
      updatedAt: now(),
      auto: true,
    };
    boards.set(board.id, board);
    while (boards.size > maxBoards) {
      const oldest = [...boards.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
      if (!oldest) break;
      boards.delete(oldest.id);
      dropBoard(oldest.id);
    }
    saveBoard(board);
    logger.info?.(`dsh-task-board: auto board created for session ${norm}`);
    return board;
  }

  /**
   * v1.3 安装会话事件钩子：pre-step 在每一轮 agent 开始时触发，session/created、
   * session/event 作为兜底。参考本机 dsh-purge 插件：ctx.on 在热重载时可能挂不上，
   * 用 late + microtask + 定时器三次重试；拿到的第一个参数即 agent（含 .session）。
   */
  function installAutoBoardHooks() {
    if (typeof ctx.on !== 'function') return;
    let installed = false;
    let disposeHook = null;
    const onEvent = (payload) => {
      if (disposed) return;
      // agent/pre-step 的 payload 是 agent（有 .session）；兜底事件给的是 session 本身。
      const exec = payload && payload.session
        ? { agent: payload }
        : { agent: { session: payload } };
      Promise.resolve(ensureAutoBoard(exec)).catch((error) => {
        logger.warn?.(`dsh-task-board: auto board failed (${error?.message ?? error})`);
      });
    };
    const install = () => {
      if (installed || disposed) return;
      try {
        const d = ctx.on('agent/pre-step', onEvent, { global: true, prepend: true });
        if (typeof d === 'function') {
          disposeHook = d;
          installed = true;
        }
      } catch {
        /* 下一次重试 */
      }
    };
    install();
    if (!installed) queueMicrotask(install);
    let retryTimer = null;
    if (!installed) {
      retryTimer = setTimeout(install, 1500);
      if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
    }
    ctx.effect(() => () => {
      if (retryTimer) clearTimeout(retryTimer);
      try { if (typeof disposeHook === 'function') disposeHook(); } catch { /* ignore */ }
    });
  }

  /**
   * 把产物字符串解析成磁盘上的真实路径。
   * 候选顺序：整串 → 第一个空白分段；相对路径依次相对 看板会话 cwd → config.cwd → 进程 cwd。
   */
  function resolveArtifact(rawPath, board) {
    const candidates = [];
    const push = (p) => {
      const clean = String(p || '').replace(/^["']|["']$/g, '');
      if (clean && !candidates.includes(clean)) candidates.push(clean);
    };
    const tryRaw = (s) => {
      const p = expandHome(String(s || '').trim());
      if (!p) return;
      push(p);
      if (!isAbsoluteLike(p)) {
        const cwds = [];
        if (board && typeof board.cwd === 'string' && board.cwd.trim()) cwds.push(board.cwd.trim());
        if (typeof config.cwd === 'string' && config.cwd.trim()) cwds.push(config.cwd.trim());
        try {
          if (typeof process !== 'undefined' && typeof process.cwd === 'function') cwds.push(process.cwd());
        } catch {
          /* 进程 cwd 不可用就跳过 */
        }
        for (const base of cwds) push(resolve(base, p));
      }
    };
    tryRaw(rawPath);
    const firstToken = String(rawPath || '').split(/\s+/)[0];
    if (firstToken && firstToken !== rawPath) tryRaw(firstToken);
    for (const p of candidates) {
      try {
        const st = statSync(p);
        return { absolute: p, isDir: st.isDirectory(), size: st.size };
      } catch {
        /* 试下一个候选 */
      }
    }
    return null;
  }

  /** 产物预览：返回给前端的元信息（文件内容走 GET artifact-file）。 */
  function artifactPreview(input) {
    const raw = str(input.path, LIMITS.artifact);
    if (!raw) throw new Error('缺少产物路径');
    const board = typeof input.boardId === 'string' && boards.has(input.boardId) ? boards.get(input.boardId) : null;
    const { url, path } = extractArtifact(raw);
    if (url) return { kind: 'url', url, name: url, path: '' };
    if (!path) return { kind: 'missing', name: raw, path: '' };
    const hit = resolveArtifact(path, board);
    if (!hit) return { kind: 'missing', name: path, path: '' };
    const name = basename(hit.absolute) || hit.absolute;
    if (hit.isDir) {
      let files = [];
      try {
        files = readdirSync(hit.absolute)
          .slice(0, DIR_LIST_LIMIT)
          .map((entry) => {
            try {
              return { name: entry, isDir: statSync(join(hit.absolute, entry)).isDirectory() };
            } catch {
              return { name: entry, isDir: false };
            }
          });
      } catch {
        files = [];
      }
      return { kind: 'dir', name, path: hit.absolute, files };
    }
    const ext = extname(hit.absolute).toLowerCase();
    if (ARTIFACT_MIME[ext]) {
      if (hit.size > ARTIFACT_MAX_BYTES) return { kind: 'tooLarge', name, path: hit.absolute, size: hit.size };
      return { kind: ext === '.pdf' ? 'pdf' : 'image', mime: ARTIFACT_MIME[ext], name, path: hit.absolute, size: hit.size };
    }
    const asText = TEXT_EXTS.has(ext) || hit.size <= TEXT_MAX_BYTES;
    if (asText) {
      if (hit.size > ARTIFACT_MAX_BYTES) return { kind: 'tooLarge', name, path: hit.absolute, size: hit.size };
      try {
        const text = readFileSync(hit.absolute, 'utf8');
        return {
          kind: 'text',
          name,
          path: hit.absolute,
          text: text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}\n…（内容过长，已截断）` : text,
        };
      } catch {
        return { kind: 'unsupported', name, path: hit.absolute };
      }
    }
    return { kind: 'unsupported', name, path: hit.absolute };
  }

  // ── 持久化（失败降级内存） ──────────────────────────────────────────────
  function openStore() {
    if (storeReady) return storeReady;
    storeReady = (async () => {
      const storage = ctx.get('storage');
      if (!storage || !storage.backend) return null;
      let backend;
      try {
        backend = storage.backend.get('json');
      } catch {
        return null;
      }
      try {
        return await backend.kv.open({
          name: STORE_UNIT,
          version: STORE_VERSION,
          tables: [BOARD_TABLE],
          layout: 'per-record',
        });
      } catch (error) {
        logger.warn?.(`dsh-task-board: storage unavailable (${error?.message ?? error}); memory only`);
        return null;
      }
    })();
    return storeReady;
  }

  function saveBoard(board) {
    if (!store) return;
    Promise.resolve(store.putRecord(BOARD_TABLE, board.id, board)).catch(() => {});
  }

  function dropBoard(id) {
    if (!store) return;
    Promise.resolve(store.deleteRecord(BOARD_TABLE, id)).catch(() => {});
  }

  async function restore() {
    const unit = await openStore();
    if (!unit) return;
    store = unit;
    try {
      const state = await unit.loadAll();
      let rows = state && state.tables ? (state.tables.get ? state.tables.get(BOARD_TABLE) : state.tables[BOARD_TABLE]) : undefined;
      if (rows instanceof Map) rows = [...rows.values()];
      else if (!Array.isArray(rows)) rows = rows ? Object.values(rows) : [];
      for (const row of rows) {
        if (!row || typeof row.id !== 'string') continue;
        boards.set(row.id, {
          id: row.id,
          title: str(row.title, LIMITS.title, '未命名任务'),
          requirement: str(row.requirement, LIMITS.requirement),
          sessionDemand: str(row.sessionDemand, LIMITS.requirement),
          status: clampStatus(row.status, STATUS_BOARD, 'planning'),
          processing: normalizeItems(row.processing, 'processing'),
          delivery: normalizeItems(row.delivery, 'delivery'),
          sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
          cwd: typeof row.cwd === 'string' ? row.cwd : '',
          createdAt: Number(row.createdAt) || now(),
          updatedAt: Number(row.updatedAt) || now(),
          auto: row.auto === true,
        });
      }
    } catch (error) {
      logger.warn?.(`dsh-task-board: restore failed (${error?.message ?? error})`);
    }
  }

  const sortedBoards = () => [...boards.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const viewBoard = (board) => publicBoard(board, archivedSessions);

  function findBoard(boardId, title) {
    if (typeof boardId === 'string' && boardId.trim() && boards.has(boardId.trim())) return boards.get(boardId.trim());
    if (typeof title === 'string' && title.trim()) {
      const t = title.trim();
      const hit = sortedBoards().find((board) => board.title === t || board.title.includes(t));
      if (hit) return hit;
    }
    if (boardId || title) return null;
    return sortedBoards()[0] || null;
  }

  // ── 服务层（HTTP 与工具共用同一实现） ───────────────────────────────────
  const service = {
    state() {
      const list = sortedBoards().map(viewBoard);
      return {
        boards: list,
        stats: {
          total: list.length,
          working: list.filter((b) => !b.archived && (b.status === 'working' || b.status === 'blocked' || b.status === 'planning')).length,
          done: list.filter((b) => !b.archived && b.status === 'done').length,
          archived: list.filter((b) => b.archived).length,
        },
        version: '1.1.0',
      };
    },

    detail(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      return viewBoard(board);
    },

    async plan(input, exec) {
      const title = str(input.title, LIMITS.title);
      if (!title) throw new Error('任务标题不能为空');
      const captured = await captureSession(exec);
      const wantedSid = input.sessionId ? str(input.sessionId, 120) : captured.sessionId;
      // v1.3：若本会话已被自动建过草稿板，模型再用 task_board_plan 建板时复用它，
      // 用模型整理的标题/清单覆盖草稿，避免同一会话出现两块看板。
      const draft = [...boards.values()].find(
        (b) => b.auto && normSid(b.sessionId) && wantedSid && normSid(b.sessionId) === normSid(wantedSid),
      );
      if (draft) {
        draft.title = title;
        draft.auto = false;
        draft.requirement = str(input.requirement, LIMITS.requirement, draft.requirement);
        draft.sessionDemand = captured.sessionDemand || draft.sessionDemand || str(input.sessionDemand, LIMITS.requirement);
        draft.processing = normalizeItems(input.processing, 'processing');
        draft.delivery = normalizeItems(input.delivery, 'delivery');
        draft.cwd = input.cwd ? str(input.cwd, 500) : (captured.cwd || draft.cwd);
        draft.updatedAt = now();
        saveBoard(draft);
        return viewBoard(draft);
      }
      const board = {
        id: randomUUID(),
        title,
        requirement: str(input.requirement, LIMITS.requirement),
        sessionDemand: captured.sessionDemand || str(input.sessionDemand, LIMITS.requirement),
        status: 'planning',
        processing: normalizeItems(input.processing, 'processing'),
        delivery: normalizeItems(input.delivery, 'delivery'),
        sessionId: input.sessionId ? str(input.sessionId, 120) : captured.sessionId,
        cwd: input.cwd ? str(input.cwd, 500) : captured.cwd || (typeof config.cwd === 'string' ? config.cwd.trim() : ''),
        createdAt: now(),
        updatedAt: now(),
      };
      boards.set(board.id, board);
      while (boards.size > maxBoards) {
        const oldest = [...boards.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
        if (!oldest) break;
        boards.delete(oldest.id);
        dropBoard(oldest.id);
      }
      saveBoard(board);
      return viewBoard(board);
    },

    update(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      const type = input.type === 'board' || input.type === 'task' || input.itemType === 'board'
        ? 'board'
        : (TYPE_TO_ITEM[input.itemType || input.type] || '');
      if (!type) throw new Error('itemType 必须是 processing、delivery 或 board');
      if (type === 'board') {
        if (input.status !== undefined) board.status = clampStatus(input.status, STATUS_BOARD, board.status);
        if (typeof input.result === 'string') board.requirement = str(input.result, LIMITS.requirement, board.requirement);
      } else {
        const list = board[type];
        const locator = typeof input.itemId === 'string' && input.itemId.trim()
          ? (item) => item.id === input.itemId.trim()
          : (item) => {
              const wanted = str(input.itemTitle, LIMITS.title);
              return Boolean(wanted) && (item.title === wanted || item.title.includes(wanted));
            };
        const item = list.find(locator);
        if (!item) throw new Error(`在${LABEL[type]}里找不到这一项（用 itemId 或 itemTitle 指定）`);
        if (input.status !== undefined) item.status = clampStatus(input.status, STATUS_ITEM, item.status);
        if (typeof input.result === 'string') item.result = str(input.result, LIMITS.result);
        if (typeof input.artifact === 'string') item.artifact = str(input.artifact, LIMITS.artifact);
        if (typeof input.detail === 'string' && type === 'processing') item.detail = str(input.detail, LIMITS.detail);
        if (typeof input.owner === 'string' && type === 'processing') item.owner = str(input.owner, 80);
        if (typeof input.spec === 'string' && type === 'delivery') item.detail = str(input.spec, LIMITS.spec);
        item.updatedAt = now();
      }
      board.status = deriveBoardStatus(board);
      board.updatedAt = now();
      saveBoard(board);
      return viewBoard(board);
    },

    add(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      const kind = TYPE_TO_ITEM[input.itemType] || 'processing';
      const item = makeItem(input, kind, board[kind].length);
      if (!item) throw new Error('要补充的清单项缺少 title');
      board[kind].push(item);
      board.status = deriveBoardStatus(board);
      board.updatedAt = now();
      saveBoard(board);
      return viewBoard(board);
    },

    remove(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      boards.delete(board.id);
      dropBoard(board.id);
      return { id: board.id };
    },

    artifact(input) {
      return artifactPreview(input);
    },
  };

  // ── HTTP API（浏览器面板轮询） ──────────────────────────────────────────
  function route(path, handler) {
    return ctx.effect(() =>
      ctx.connection.fetch.register({
        path,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          let body = {};
          try {
            body = await request.json();
          } catch {
            body = {};
          }
          try {
            return ok(await handler(body || {}));
          } catch (error) {
            return fail('bad-request', error && error.message ? error.message : String(error));
          }
        },
      }),
    );
  }

  route('/api/dsh-task-board/state', async () => {
    await refreshArchived();
    return service.state();
  });
  route('/api/dsh-task-board/detail', (body) => service.detail(body));
  route('/api/dsh-task-board/plan', (body) => service.plan(body, null));
  route('/api/dsh-task-board/update', (body) => service.update(body));
  route('/api/dsh-task-board/add', (body) => service.add(body));
  route('/api/dsh-task-board/remove', (body) => service.remove(body));
  route('/api/dsh-task-board/artifact', (body) => service.artifact(body));

  // ── 产物文件流（图片/PDF 用 <img>/<iframe> 同源引用，走 GET） ───────────
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/dsh-task-board/artifact-file',
      methods: ['GET'],
      async fetch(request) {
        try {
          const url = new URL(request.url);
          const p = String(url.searchParams.get('path') || '');
          const hit = p ? resolveArtifact(p, null) : null;
          const ext = hit ? extname(hit.absolute).toLowerCase() : '';
          if (!hit || hit.isDir) return new Response(null, { status: 404 });
          if (!ARTIFACT_MIME[ext]) return new Response(null, { status: 415 });
          if (hit.size > ARTIFACT_MAX_BYTES) return new Response(null, { status: 413 });
          const data = await readFile(hit.absolute);
          return new Response(data, {
            headers: { 'content-type': ARTIFACT_MIME[ext], 'cache-control': 'no-store' },
          });
        } catch {
          return new Response(null, { status: 400 });
        }
      },
    }),
  );

  // ── Agent 工具 ──────────────────────────────────────────────────────────
  const boardResult = (args, board) => [
    { type: 'text', text: renderBoardMarkdown(board, archivedSessions) },
  ];

  function registerTool(tool) {
    try {
      const off = ctx.tools.register(tool);
      if (typeof off === 'function') ctx.effect(() => off);
    } catch (error) {
      logger.warn?.(`dsh-task-board: tool ${tool.name} unavailable (${error?.message ?? error})`);
    }
  }

  registerTool({
    name: 'task_board_plan',
    description:
      '分发任务或收到明确需求后，先调用本工具建立任务看板：按需求列出「处理清单」（要处理的事项、负责人）和「交付清单」（要交付的产物、交付标准）。' +
      '当前会话的用户原始需求会被插件自动记录到看板。之后执行中要用 task_board_update 更新状态、处理结果和产物。返回当前看板的 Markdown。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '一句话任务标题' },
        requirement: { type: 'string', description: '整理后的需求目标与范围' },
        processing: {
          type: 'array',
          description: '处理清单：需要做的事',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', description: '事项名称' },
              detail: { type: 'string', description: '具体做法/要点' },
              owner: { type: 'string', description: '负责人（可选）' },
            },
            required: ['title'],
          },
        },
        delivery: {
          type: 'array',
          description: '交付清单：要交付的产物',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', description: '产物名称' },
              spec: { type: 'string', description: '交付标准/验收口径' },
            },
            required: ['title'],
          },
        },
      },
      required: ['title', 'requirement'],
    },
    output: { schema: { type: 'object' }, render: boardResult },
    async execute(args, exec) {
      return service.plan(
        {
          title: args.title,
          requirement: args.requirement,
          processing: args.processing,
          delivery: args.delivery,
        },
        exec,
      );
    },
  });

  registerTool({
    name: 'task_board_update',
    description:
      '更新任务看板某一项的状态、处理结果或产物。开始做时 status=doing，做完填 result 与 artifact 并置 done，受阻置 blocked 并写清原因。' +
      '任务整体收尾时用 type="board"、status="done"。可用 boardId 或 title 定位任务板，用 itemId/itemTitle 定位清单项。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        boardId: { type: 'string', description: '任务板 id（可选，默认最近一张）' },
        title: { type: 'string', description: '任务标题（boardId 缺省时可用）' },
        itemType: { type: 'string', enum: ['processing', 'delivery', 'board'], description: '要更新处理清单、交付清单还是整张板' },
        itemId: { type: 'string', description: '清单项 id，如 p1 / d2' },
        itemTitle: { type: 'string', description: '清单项标题（itemId 缺省时可用）' },
        status: { type: 'string', enum: ['pending', 'doing', 'done', 'blocked'], description: '清单项状态；board 时可用 planning/working/done/blocked' },
        result: { type: 'string', description: '处理结果（受阻时写原因；board 时写总结）' },
        artifact: { type: 'string', description: '产物：文件路径、链接或文件名' },
        detail: { type: 'string', description: '（处理清单）补充要点' },
        owner: { type: 'string', description: '（处理清单）负责人' },
        spec: { type: 'string', description: '（交付清单）交付标准' },
      },
      required: ['itemType'],
    },
    output: { schema: { type: 'object' }, render: boardResult },
    execute(args) {
      return Promise.resolve(service.update(args));
    },
  });

  registerTool({
    name: 'task_board_add',
    description: '往现有任务看板临时补充一条处理清单或交付清单项。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        boardId: { type: 'string', description: '任务板 id（可选，默认最近一张）' },
        title: { type: 'string', description: '任务标题（boardId 缺省时可用）' },
        itemType: { type: 'string', enum: ['processing', 'delivery'], description: '补到哪份清单' },
        itemTitle: { type: 'string', description: '新清单项标题' },
        detail: { type: 'string', description: '要点（处理清单）' },
        spec: { type: 'string', description: '交付标准（交付清单）' },
        owner: { type: 'string', description: '负责人（可选）' },
      },
      required: ['itemType', 'itemTitle'],
    },
    output: { schema: { type: 'object' }, render: boardResult },
    execute(args) {
      return Promise.resolve(service.add({ ...args, title: args.itemTitle }));
    },
  });

  registerTool({
    name: 'task_board_show',
    description:
      '读取任务看板的真实进度。用户问「进度如何 / 做了什么 / 交付了什么」时先调用本工具，按返回的状态、处理结果和产物回答，不要凭记忆编造。归档任务会单独列出，不计入进行中。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        boardId: { type: 'string', description: '任务板 id（可选）' },
        title: { type: 'string', description: '任务标题（可选）' },
        all: { type: 'boolean', description: '为 true 时展示全部任务板' },
      },
    },
    output: {
      schema: { type: 'object' },
      // all / 空看板 时返回值是 { boards, markdown }，不能套 boardResult（否则标题渲染成 undefined）
      render(_args, value) {
        const markdown = value && typeof value.markdown === 'string' ? value.markdown.trim() : '';
        return [{ type: 'text', text: markdown || renderBoardMarkdown(value, archivedSessions) }];
      },
    },
    execute(args) {
      if (args.all) {
        const list = sortedBoards();
        if (!list.length) return Promise.resolve({ boards: [], markdown: '（还没有任务看板）' });
        return Promise.resolve({
          boards: list.map(viewBoard),
          markdown: list.map((board) => renderBoardMarkdown(board, archivedSessions)).join('\n\n---\n\n'),
        });
      }
      if (!boards.size) return Promise.resolve({ boards: [], markdown: '（还没有任务看板）' });
      return Promise.resolve(service.detail(args));
    },
  });

  registerTool({
    name: 'task_board_remove',
    description: '删除一张任务看板（仅删除看板记录，不会影响实际文件或代码）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        boardId: { type: 'string', description: '任务板 id（可选）' },
        title: { type: 'string', description: '任务标题（可选）' },
      },
    },
    output: {
      schema: { type: 'object', properties: { id: { type: 'string' } } },
      render(_args, value) {
        return [{ type: 'text', text: `已删除任务看板 ${value && value.id ? value.id : ''}` }];
      },
    },
    execute(args) {
      return Promise.resolve(service.remove(args));
    },
  });

  // ── 自动触发：注入系统提示词 ────────────────────────────────────────────
  try {
    let order = 500;
    const sp = ctx.systemPrompt;
    if (sp && typeof sp.getSectionOrder === 'function') {
      try {
        order = (Number(sp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')) || 0) + 3;
      } catch {
        order = 500;
      }
    }
    ctx.systemPrompt.section({ name: 'dsh-task-board:guide', order, text: PROMPT_TEXT });
  } catch (error) {
    logger.warn?.(`dsh-task-board: system prompt injection failed (${error?.message ?? error})`);
  }

  // ── 兜底斜杠命令：/dsh-task-board 查看当前看板 ──────────────────────────
  try {
    const commands = ctx.get('commands');
    const off = commands.register({
      name: 'dsh-task-board',
      description: '查看任务看板当前进度：/dsh-task-board（留空看最近任务，填标题看指定任务，all 看全部）',
      input: { hint: '标题 | all' },
      handler(invocation) {
        try {
          const raw = String(invocation.rawInput || '').trim();
          if (!raw) {
            const board = sortedBoards()[0];
            return {
              kind: 'success',
              text: board ? renderBoardMarkdown(board, archivedSessions) : '还没有任务看板。分发任务时我会自动建立。',
            };
          }
          if (raw.toLowerCase() === 'all') {
            const list = sortedBoards();
            return {
              kind: 'success',
              text: list.length ? list.map((board) => renderBoardMarkdown(board, archivedSessions)).join('\n\n---\n\n') : '还没有任务看板。',
            };
          }
          return { kind: 'success', text: renderBoardMarkdown(service.detail({ title: raw }), archivedSessions) };
        } catch (error) {
          return { kind: 'error', text: error && error.message ? error.message : String(error) };
        }
      },
    });
    if (typeof off === 'function') ctx.effect(() => off);
  } catch (error) {
    logger.warn?.(`dsh-task-board: slash command unavailable (${error?.message ?? error})`);
  }

  // ── 生命周期：定时刷新归档列表 ──────────────────────────────────────────
  ctx.effect(() => {
    refreshArchived();
    const timer = setInterval(refreshArchived, archivePollMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  });

  ctx.effect(() => () => {
    disposed = true;
    if (store && typeof store.close === 'function') Promise.resolve(store.close()).catch(() => {});
    store = null;
  });

  // v1.3：钩子和恢复并行安装。pre-step 事件可能在 restore 完成前到达，
  // ensureAutoBoard 内部用 autoBoarded Set 去重，配合 restore 后的现有板检查。
  installAutoBoardHooks();
  (async () => {
    await Promise.all([refreshArchived(), restore()]);
    if (disposed) return;
    // 恢复完成后，把已存在看板的会话登记为「已处理」，防止 pre-step 再建重复板。
    for (const board of boards.values()) {
      const norm = normSid(board.sessionId);
      if (norm) autoBoarded.add(norm);
    }
    logger.info?.('dsh-task-board ready');
  })().catch((error) => {
    logger.warn?.(`dsh-task-board: init failed (${error?.message ?? error})`);
  });
}
