/**
 * dsh-task-board — Host half.
 *
 * 任务分发后，让智能体按需求自动生成「处理清单」与「交付清单」，
 * 并把当前进度、处理结果、交付产物集中记录到一块看板上：
 *   - 对话里：工具以 Markdown 输出清单（task_board_plan / update / show）；
 *   - 侧边栏：浏览器半身通过 /api/dsh-task-board/* 轮询展示进度。
 *
 * DSH 约束（与本机已装的 dsh-notes-panel / 社区 dsh-company 一致）：
 * - apply(ctx, config) 里所有注册都走 ctx / ctx.effect，卸载自动回滚；
 * - 工具用 ctx.tools.register({ name, description, parameters, output, execute })；
 * - HTTP 用 ctx.connection.fetch.register({ path, methods, requestBody, fetch })，返回 Response.json；
 * - 持久化用 ctx.get('storage').backend.get('json').kv.open(...)，失败降级内存；
 * - 自动触发靠 ctx.systemPrompt.section(...) 注入指引，而不是监听不稳定的内部事件。
 */

import { randomUUID } from 'node:crypto';

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

/** 清单项的展示文案。 */
const LABEL = {
  pending: '待处理',
  doing: '进行中',
  done: '已完成',
  blocked: '受阻',
  planning: '规划中',
  working: '进行中',
  processing: '处理清单',
  delivery: '交付清单',
};

const PROMPT_TEXT = [
  '## 任务看板（处理清单 / 交付清单）',
  '本会话安装了 dsh-task-board 插件，用于让用户随时看到任务进度、要处理什么、处理结果和产物。',
  '请遵守以下工作流（不需要用户输入任何命令）：',
  '1. 当用户分发任务、委派子任务，或给出一个明确需求/目标后，在动手之前先调用 task_board_plan：',
  '   title 写一句话任务名，requirement 写用户原始需求，processing 写要处理的事项（title/detail/owner），',
  '   delivery 写要交付的产物（title/spec）。两份清单要根据需求具体、可验收，不要写空话。',
  '2. 执行过程中，每完成或推进一项，就用 task_board_update 更新该项的 status、result（处理结果）、artifact（产物路径/链接/文件名）。',
  '   开始一项时把 status 设为 doing；受阻设为 blocked 并在 result 写清原因。',
  '3. 需要临时补一项时调用 task_board_add；整个任务收尾时把 board status 设为 done。',
  '4. 用户问「进度如何 / 做了什么 / 交付了什么」时，先调用 task_board_show 读取真实看板再回答，',
  '   不要凭记忆编造进度；回答里直接引用清单里的状态、处理结果和产物。',
  '5. 每个交付项在真正产出文件/链接之前不得标记 done，只能标 doing 或 pending。',
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

function publicBoard(board) {
  const progress = progressOf(board);
  return {
    id: board.id,
    title: board.title,
    requirement: board.requirement || '',
    status: deriveBoardStatus(board),
    processing: (board.processing || []).map((item) => ({ ...item })),
    delivery: (board.delivery || []).map((item) => ({ ...item })),
    progress,
    sessionId: board.sessionId || '',
    createdAt: board.createdAt || 0,
    updatedAt: board.updatedAt || 0,
  };
}

function renderBoardMarkdown(board) {
  const view = publicBoard(board);
  const lines = [
    `# 任务看板：${view.title}`,
    `状态：${LABEL[view.status] || view.status} · 进度：${view.progress.done}/${view.progress.total}（${view.progress.percent}%）`,
  ];
  if (view.requirement) lines.push('', '## 需求', view.requirement);
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

  const maxBoards = Number.isFinite(config.maxBoards) && config.maxBoards > 0 ? Math.floor(config.maxBoards) : 200;

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
          status: clampStatus(row.status, STATUS_BOARD, 'planning'),
          processing: normalizeItems(row.processing, 'processing'),
          delivery: normalizeItems(row.delivery, 'delivery'),
          sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
          createdAt: Number(row.createdAt) || now(),
          updatedAt: Number(row.updatedAt) || now(),
        });
      }
    } catch (error) {
      logger.warn?.(`dsh-task-board: restore failed (${error?.message ?? error})`);
    }
  }

  const sortedBoards = () => [...boards.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

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

  function rememberSession(exec) {
    const session = exec && exec.agent && exec.agent.session;
    if (session && typeof session.id === 'string') return session.id;
    return '';
  }

  // ── 服务层（HTTP 与工具共用同一实现） ───────────────────────────────────
  const service = {
    state() {
      const list = sortedBoards().map(publicBoard);
      return {
        boards: list,
        stats: {
          total: list.length,
          working: list.filter((b) => b.status === 'working' || b.status === 'blocked').length,
          done: list.filter((b) => b.status === 'done').length,
        },
        version: '1.0.0',
      };
    },

    detail(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      return publicBoard(board);
    },

    plan(input, exec) {
      const title = str(input.title, LIMITS.title);
      if (!title) throw new Error('任务标题不能为空');
      const board = {
        id: randomUUID(),
        title,
        requirement: str(input.requirement, LIMITS.requirement),
        status: 'planning',
        processing: normalizeItems(input.processing, 'processing'),
        delivery: normalizeItems(input.delivery, 'delivery'),
        sessionId: input.sessionId ? str(input.sessionId, 120) : rememberSession(exec),
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
      return publicBoard(board);
    },

    update(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      const type = input.type === 'board' || input.type === 'task' ? 'board' : (TYPE_TO_ITEM[input.itemType || input.type] || '');
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
      return publicBoard(board);
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
      return publicBoard(board);
    },

    remove(input) {
      const board = findBoard(input.boardId, input.title);
      if (!board) throw new Error('找不到对应的任务板');
      boards.delete(board.id);
      dropBoard(board.id);
      return { id: board.id };
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

  route('/api/dsh-task-board/state', () => service.state());
  route('/api/dsh-task-board/detail', (body) => service.detail(body));
  route('/api/dsh-task-board/plan', (body) => service.plan(body, null));
  route('/api/dsh-task-board/update', (body) => service.update(body));
  route('/api/dsh-task-board/add', (body) => service.add(body));
  route('/api/dsh-task-board/remove', (body) => service.remove(body));

  // ── Agent 工具 ──────────────────────────────────────────────────────────
  const boardResult = (args, board) => [
    { type: 'text', text: renderBoardMarkdown(board) },
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
      '之后执行中要用 task_board_update 更新状态、处理结果和产物。返回当前看板的 Markdown。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '一句话任务标题' },
        requirement: { type: 'string', description: '用户的原始需求/背景/目标' },
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
    execute(args, exec) {
      const board = service.plan(
        {
          title: args.title,
          requirement: args.requirement,
          processing: args.processing,
          delivery: args.delivery,
        },
        exec,
      );
      return Promise.resolve(board);
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
      '读取任务看板的真实进度。用户问「进度如何 / 做了什么 / 交付了什么」时先调用本工具，按返回的状态、处理结果和产物回答，不要凭记忆编造。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        boardId: { type: 'string', description: '任务板 id（可选）' },
        title: { type: 'string', description: '任务标题（可选）' },
        all: { type: 'boolean', description: '为 true 时展示全部任务板' },
      },
    },
    output: { schema: { type: 'object' }, render: boardResult },
    execute(args) {
      if (args.all) {
        const list = sortedBoards();
        if (!list.length) return Promise.resolve({ boards: [], markdown: '（还没有任务看板）' });
        return Promise.resolve({ boards: list.map(publicBoard), markdown: list.map(renderBoardMarkdown).join('\n\n---\n\n') });
      }
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
              text: board ? renderBoardMarkdown(board) : '还没有任务看板。分发任务时我会自动建立。',
            };
          }
          if (raw.toLowerCase() === 'all') {
            const list = sortedBoards();
            return {
              kind: 'success',
              text: list.length ? list.map(renderBoardMarkdown).join('\n\n---\n\n') : '还没有任务看板。',
            };
          }
          return { kind: 'success', text: renderBoardMarkdown(service.detail({ title: raw })) };
        } catch (error) {
          return { kind: 'error', text: error && error.message ? error.message : String(error) };
        }
      },
    });
    if (typeof off === 'function') ctx.effect(() => off);
  } catch (error) {
    logger.warn?.(`dsh-task-board: slash command unavailable (${error?.message ?? error})`);
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    disposed = true;
    if (store && typeof store.close === 'function') Promise.resolve(store.close()).catch(() => {});
    store = null;
  });

  (async () => {
    await restore();
    if (disposed) return;
    logger.info?.('dsh-task-board ready');
  })().catch((error) => {
    logger.warn?.(`dsh-task-board: init failed (${error?.message ?? error})`);
  });
}
