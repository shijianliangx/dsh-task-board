/**
 * Browser half of the task-board bundle: one entry in the left sidebar
 * (`sidebar.panellist`) and the full-width panel it selects (`main`).
 *
 * The panel polls the host HTTP API written by index.js. It only reads state;
 * the writing path is the agent tools, so what you see is what the agent recorded.
 */
window.__ModuleLoader__.load({
  id: '@taozi0328/dsh-task-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const NS = 'dshTaskBoard'
    const PANEL_ID = 'task-board'

    const EN = {
      panel: 'Task Board',
      title: 'Task Board',
      subtitle: 'Processing checklist & delivery checklist, updated by the agent as work progresses.',
      refresh: 'Refresh',
      search: 'Search',
      searchPlaceholder: 'Search title, requirement, results, artifacts…',
      noMatch: 'No task boards match your search.',
      clearSearch: 'Clear search',
      loading: 'Loading…',
      loadFailed: 'Cannot reach the plugin backend',
      retry: 'Retry',
      empty: 'No task board yet. After you dispatch a task, the agent will create one automatically.',
      total: 'Tasks',
      working: 'In progress',
      done: 'Done',
      archived: 'Archived',
      tabActive: 'Active',
      tabDone: 'Done',
      tabArchived: 'Archived',
      sessionDemand: 'User request from session',
      preview: 'Preview',
      previewLoading: 'Loading preview…',
      previewMissing: 'Artifact file not found — it may have been moved, or the path is relative to another directory.',
      previewUnsupported: 'This file type cannot be previewed here. Open it locally instead.',
      previewTooLarge: 'File is too large to preview.',
      close: 'Close',
      emptyDir: 'Empty folder.',
      openUrl: 'Open link',
      emptyActive: 'No active task boards.',
      emptyDone: 'No completed task boards.',
      emptyArchived: 'No archived task boards. When a session is archived, its tasks move here.',
      requirement: 'Requirement',
      processing: 'Processing checklist',
      delivery: 'Delivery checklist',
      noItems: 'Nothing here yet.',
      result: 'Result',
      artifact: 'Artifact',
      owner: 'Owner',
      detail: 'Details',
      spec: 'Acceptance',
      progress: 'Progress',
      pending: 'Pending',
      doing: 'In progress',
      doneItem: 'Done',
      blocked: 'Blocked',
      planning: 'Planning',
      workingBoard: 'In progress',
      doneBoard: 'Done',
      updated: 'Updated',
      of: 'of',
    }

    const ZH = {
      panel: '任务看板',
      title: '任务看板',
      subtitle: '处理清单与交付清单，随任务执行由智能体实时更新。当前进度、处理结果和产物一目了然。',
      refresh: '刷新',
      search: '搜索',
      searchPlaceholder: '搜索标题、需求、处理结果、产物…',
      noMatch: '没有匹配的任务看板。',
      clearSearch: '清除搜索',
      loading: '加载中…',
      loadFailed: '连不上插件后端',
      retry: '重试',
      empty: '还没有任务看板。分发任务后，智能体会自动建立处理清单和交付清单。',
      total: '任务',
      working: '进行中',
      done: '已完成',
      archived: '已归档',
      tabActive: '进行中',
      tabDone: '已完成',
      tabArchived: '归档',
      sessionDemand: '会话中的用户需求',
      preview: '预览',
      previewLoading: '正在加载预览…',
      previewMissing: '找不到产物文件——可能已被移动，或路径相对于其他目录。',
      previewUnsupported: '该文件类型暂不支持在此预览，请在本地打开。',
      previewTooLarge: '文件过大，无法预览。',
      close: '关闭',
      emptyDir: '（空目录）',
      openUrl: '打开链接',
      emptyActive: '没有进行中的任务。',
      emptyDone: '没有已完成的任务。',
      emptyArchived: '没有归档的任务。会话归档后，其任务会自动移到这里。',
      requirement: '需求（智能体整理）',
      processing: '处理清单',
      delivery: '交付清单',
      noItems: '（暂无条目）',
      result: '处理结果',
      artifact: '产物',
      owner: '负责人',
      detail: '要点',
      spec: '交付标准',
      progress: '进度',
      pending: '待处理',
      doing: '进行中',
      doneItem: '已完成',
      blocked: '受阻',
      planning: '规划中',
      workingBoard: '进行中',
      doneBoard: '已完成',
      updated: '更新于',
      of: '/',
    }

    const CSS = [
      '.dtb-page{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:0 clamp(20px,3vw,40px);',
      'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}',
      '@media (max-width:767px){.dtb-page{padding:0 16px}}',
      'html[data-platform="darwin"] .dtb-inner{padding-top:calc(24px + var(--dsh-frame-top-clearance,0px))}',
      '.dtb-inner{display:flex;flex-direction:column;gap:18px;width:100%;max-width:1040px;margin:0 auto;padding:24px 0 40px;box-sizing:border-box}',
      '.dtb-head{display:flex;align-items:flex-start;gap:14px}',
      '.dtb-head h1{margin:0;font-size:21px;line-height:1.3;font-weight:600;letter-spacing:-0.01em}',
      '.dtb-head p{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.dtb-spacer{flex:1}',
      '.dtb-btn{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 12px;background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dtb-btn:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dtb-btn:disabled{opacity:.55;cursor:default}',
      '.dtb-search{display:flex;align-items:center;gap:8px;width:100%;max-width:520px;border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:9px;padding:0 10px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}',
      '.dtb-search:focus-within{border-color:var(--dsw-alias-brand-primary)}',
      '.dtb-search-icon{font-size:13px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.dtb-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:12px;padding:8px 0}',
      '.dtb-search input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}',
      '.dtb-search-clear{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;',
      'font:inherit;font-size:16px;line-height:1;padding:2px 4px;flex:none}',
      '.dtb-search-clear:hover{color:var(--dsw-alias-label-primary)}',
      '.dtb-tabs{display:flex;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);width:fit-content}',
      '.dtb-tab{border:0;border-radius:7px;padding:6px 14px;background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:7px;white-space:nowrap}',
      '.dtb-tab:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dtb-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dtb-tab i{font-style:normal;font-size:10px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dtb-tab[data-active="true"] i{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted, #fff)}',
      '.dtb-stats{display:flex;gap:10px;flex-wrap:wrap}',
      '.dtb-stat{display:flex;flex-direction:column;gap:2px;padding:8px 14px;border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:10px;background:var(--dsw-alias-bg-layer-1);min-width:82px}',
      '.dtb-stat b{font-size:17px;line-height:1.2}',
      '.dtb-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dtb-list{display:flex;flex-direction:column;gap:14px}',
      '.dtb-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dtb-card-head{display:flex;align-items:center;gap:10px;padding:13px 16px;cursor:pointer;flex-wrap:wrap}',
      '.dtb-card-head:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dtb-card-title{font-size:14px;font-weight:600;flex:1;min-width:160px}',
      '.dtb-badge{font-size:11px;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dtb-badge[data-s="doing"],.dtb-badge[data-s="working"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted, #fff)}',
      '.dtb-badge[data-s="done"]{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-inverted, #fff)}',
      '.dtb-badge[data-s="blocked"]{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted, #fff)}',
      '.dtb-badge[data-s="archived"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l1)}',
      '.dtb-card[data-archived="true"]{opacity:.82}',
      '.dtb-bar{width:88px;height:5px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;flex:none}',
      '.dtb-bar i{display:block;height:100%;background:var(--dsw-alias-brand-primary)}',
      '.dtb-meta{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dtb-body{border-top:1px solid var(--dsw-alias-border-l1);padding:14px 16px 18px;display:flex;flex-direction:column;gap:14px}',
      '.dtb-req{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;',
      'padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}',
      '.dtb-demand{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;',
      'padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
      '.dtb-demand b{display:block;margin-bottom:3px;font-size:11px;color:var(--dsw-alias-brand-primary)}',
      '.dtb-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '@media (max-width:820px){.dtb-cols{grid-template-columns:1fr}}',
      '.dtb-sec{min-width:0}',
      '.dtb-sec h3{margin:0 0 9px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);',
      'display:flex;align-items:center;gap:7px}',
      '.dtb-sec h3 span{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:400}',
      '.dtb-items{display:flex;flex-direction:column;gap:8px}',
      '.dtb-item{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px 11px;background:var(--dsw-alias-bg-layer-2)}',
      '.dtb-item-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.dtb-title{font-size:12px;font-weight:600;line-height:1.45;word-break:break-word}',
      '.dtb-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.dtb-dot[data-s="doing"]{background:var(--dsw-alias-brand-primary)}',
      '.dtb-dot[data-s="done"]{background:var(--dsw-alias-state-success-primary)}',
      '.dtb-dot[data-s="blocked"]{background:var(--dsw-alias-state-error-primary)}',
      '.dtb-field{margin-top:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
      '.dtb-field b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dtb-artifact{margin-top:6px;font-size:11px;line-height:1.5;word-break:break-all;color:var(--dsw-alias-brand-primary)}',
      '.dtb-artifact-btn{display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:0;border:0;background:none;',
      'font:inherit;font-size:11px;line-height:1.5;word-break:break-all;text-align:left;cursor:pointer;color:var(--dsw-alias-brand-primary);',
      'text-decoration:underline;text-underline-offset:2px}',
      '.dtb-artifact-btn:hover{opacity:.75}',
      '.dtb-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.45);padding:24px}',
      '.dtb-modal{display:flex;flex-direction:column;width:100%;max-width:920px;max-height:85vh;border-radius:14px;overflow:hidden;',
      'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 18px 50px rgba(0,0,0,.25)}',
      '.dtb-modal-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dtb-modal-title{flex:1;min-width:0}',
      '.dtb-modal-title b{display:block;font-size:13px;font-weight:600;word-break:break-all}',
      '.dtb-modal-title span{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dtb-modal-body{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-layer-2)}',
      '.dtb-modal-body img{display:block;max-width:100%;margin:0 auto}',
      '.dtb-modal-body iframe{display:block;width:100%;height:100%;min-height:62vh;border:0}',
      '.dtb-modal-body pre{margin:0;padding:16px;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;',
      'white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}',
      '.dtb-modal-note{padding:48px 24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7}',
      '.dtb-dirlist{display:flex;flex-direction:column}',
      '.dtb-dirlist button{display:flex;align-items:center;gap:8px;padding:9px 16px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);',
      'background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;text-align:left;word-break:break-all}',
      '.dtb-dirlist button:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dtb-dirlist .dtb-dir{color:var(--dsw-alias-brand-primary)}',
      '.dtb-empty{color:var(--dsw-alias-label-secondary);font-size:12px;padding:14px 0;text-align:center}',
      '.dtb-error{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
    ].join('')

    function fallbackText(key) {
      let language = 'en'
      try {
        language = String(document.documentElement.lang || navigator.language || 'en')
      } catch {
        language = 'en'
      }
      const dict = language.toLowerCase().indexOf('zh') === 0 ? ZH : EN
      return dict[key] !== undefined ? dict[key] : key
    }

    const API = (() => {
      try {
        return new URL('api/dsh-task-board', document.baseURI).pathname
      } catch {
        return '/api/dsh-task-board'
      }
    })()

    async function call(op, body) {
      const response = await fetch(`${API}/${op}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error && payload.error.message) || 'request failed')
      }
      return payload.value
    }

    function PanelIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 36 36',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', { x: 7.5, y: 6.5, width: 21, height: 23, rx: 3 }),
        h('path', { d: 'M12.5 13.5h3M12.5 18h3M12.5 22.5h3' }),
        h('path', { d: 'M19 13.5h4.5M19 18h4.5M19 22.5h4.5' }),
      )
    }

    function statusText(t, status) {
      const map = {
        pending: t('pending'),
        doing: t('doing'),
        done: t('doneItem'),
        blocked: t('blocked'),
        planning: t('planning'),
        working: t('workingBoard'),
        archived: t('archived'),
      }
      return map[status] || status || ''
    }

    function Item({ item, t, kind, onPreview }) {
      return h(
        'div',
        { className: 'dtb-item' },
        h(
          'div',
          { className: 'dtb-item-top' },
          h('span', { className: 'dtb-dot', 'data-s': item.status, 'aria-hidden': true }),
          h('span', { className: 'dtb-title' }, item.title),
          h('span', { className: 'dtb-badge', 'data-s': item.status }, statusText(t, item.status)),
        ),
        item.owner && kind === 'processing'
          ? h('div', { className: 'dtb-field' }, h('b', null, `${t('owner')}：`), item.owner)
          : null,
        item.detail
          ? h('div', { className: 'dtb-field' }, h('b', null, `${kind === 'processing' ? t('detail') : t('spec')}：`), item.detail)
          : null,
        item.result ? h('div', { className: 'dtb-field' }, h('b', null, `${t('result')}：`), item.result) : null,
        item.artifact
          ? h(
              'button',
              {
                className: 'dtb-artifact-btn',
                title: t('preview'),
                onClick: (event) => {
                  event.stopPropagation()
                  if (onPreview) onPreview(item.artifact)
                },
              },
              `${t('artifact')}：${item.artifact}`,
            )
          : null,
      )
    }

    function Section({ title, items, t, kind, onPreview }) {
      return h(
        'div',
        { className: 'dtb-sec' },
        h('h3', null, title, h('span', null, `${items.length}`)),
        items.length
          ? h(
              'div',
              { className: 'dtb-items' },
              items.map((item) => h(Item, { key: item.id || item.title, item, t, kind, onPreview })),
            )
          : h('div', { className: 'dtb-empty' }, t('noItems')),
      )
    }

    function BoardCard({ board, t, onPreview, query }) {
      // v1.4：详情默认收起，点击卡片头再展开；搜索命中时自动展开，方便看到命中的内容。
      const [open, setOpen] = useState(Boolean(query))
      useEffect(() => {
        if (query) setOpen(true)
      }, [query])
      const previewOf = useCallback(
        (artifactText) => {
          if (onPreview) onPreview(artifactText, board)
        },
        [onPreview, board],
      )
      const p = board.progress || { total: 0, done: 0, percent: 0 }
      const updated = board.updatedAt
        ? new Date(board.updatedAt).toLocaleString()
        : ''
      return h(
        'div',
        { className: 'dtb-card', 'data-archived': board.archived ? 'true' : 'false' },
        h(
          'div',
          { className: 'dtb-card-head', onClick: () => setOpen((v) => !v) },
          h('span', { className: 'dtb-card-title' }, board.title),
          board.archived
            ? h('span', { className: 'dtb-badge', 'data-s': 'archived' }, t('archived'))
            : h('span', { className: 'dtb-badge', 'data-s': board.status }, statusText(t, board.status)),
          h(
            'span',
            { className: 'dtb-bar', title: `${t('progress')} ${p.percent}%` },
            h('i', { style: { width: `${p.percent}%` } }),
          ),
          h('span', { className: 'dtb-meta' }, `${p.done}${t('of')}${p.total}`),
          updated ? h('span', { className: 'dtb-meta' }, `${t('updated')} ${updated}`) : null,
          h('span', { className: 'dtb-meta' }, open ? '▾' : '▸'),
        ),
        open
          ? h(
              'div',
              { className: 'dtb-body' },
              board.sessionDemand
                ? h('div', { className: 'dtb-demand' }, h('b', null, t('sessionDemand')), board.sessionDemand)
                : null,
              board.requirement
                ? h('div', { className: 'dtb-req' }, h('b', null, `${t('requirement')}：`), board.requirement)
                : null,
              h(
                'div',
                { className: 'dtb-cols' },
                h(Section, { title: t('processing'), items: board.processing || [], t, kind: 'processing', onPreview: previewOf }),
                h(Section, { title: t('delivery'), items: board.delivery || [], t, kind: 'delivery', onPreview: previewOf }),
              ),
            )
          : null,
      )
    }

    function PreviewModal({ preview, t, onClose, onOpenPath }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      const r = preview.result
      const fileUrl = r && r.path && (r.kind === 'image' || r.kind === 'pdf')
        ? `${API}/artifact-file?path=${encodeURIComponent(r.path)}`
        : ''
      let body = null
      if (preview.loading) {
        body = h('div', { className: 'dtb-modal-note' }, t('previewLoading'))
      } else if (preview.error) {
        body = h('div', { className: 'dtb-modal-note' }, preview.error)
      } else if (r.kind === 'image') {
        body = h('img', { src: fileUrl, alt: r.name || '' })
      } else if (r.kind === 'pdf') {
        body = h('iframe', { src: fileUrl, title: r.name || t('preview') })
      } else if (r.kind === 'text') {
        body = h('pre', null, r.text || '')
      } else if (r.kind === 'dir') {
        body = r.files && r.files.length
          ? h(
              'div',
              { className: 'dtb-dirlist' },
              r.files.map((f) =>
                h(
                  'button',
                  { key: f.name, onClick: () => onOpenPath(`${r.path}/${f.name}`) },
                  h('span', { className: f.isDir ? 'dtb-dir' : null }, f.isDir ? '[dir] ' : ''),
                  f.name,
                ),
              ),
            )
          : h('div', { className: 'dtb-modal-note' }, t('emptyDir'))
      } else if (r.kind === 'missing') {
        body = h('div', { className: 'dtb-modal-note' }, t('previewMissing'))
      } else if (r.kind === 'tooLarge') {
        body = h('div', { className: 'dtb-modal-note' }, t('previewTooLarge'))
      } else if (r.kind === 'url') {
        body = h('div', { className: 'dtb-modal-note' },
          h('button', { className: 'dtb-btn', onClick: () => { try { window.open(r.url, '_blank', 'noopener') } catch {} } }, t('openUrl')))
      } else {
        body = h('div', { className: 'dtb-modal-note' }, t('previewUnsupported'))
      }
      return h(
        'div',
        { className: 'dtb-overlay', onClick: onClose },
        h(
          'div',
          { className: 'dtb-modal', onClick: (event) => event.stopPropagation() },
          h(
            'div',
            { className: 'dtb-modal-head' },
            h(
              'div',
              { className: 'dtb-modal-title' },
              h('b', null, (r && r.name) || t('preview')),
              r && (r.path || r.url) ? h('span', null, r.path || r.url) : null,
            ),
            h('button', { className: 'dtb-btn', onClick: onClose, 'aria-label': t('close') }, '✕'),
          ),
          h('div', { className: 'dtb-modal-body' }, body),
        ),
      )
    }

    function BoardPanel(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackText
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [tab, setTab] = useState('active')
      const [query, setQuery] = useState('')
      const [preview, setPreview] = useState(null)
      const aliveRef = useRef(true)

      const openPreview = useCallback(async (artifactText, board) => {
        const first = String(artifactText || '').trim().split(/\r?\n/)[0] || ''
        if (/^https?:\/\//i.test(first.trim())) {
          try {
            window.open(first.trim().split(/\s+/)[0], '_blank', 'noopener')
          } catch {
            /* 弹窗被拦截时落到弹层里给打开按钮 */
          }
          return
        }
        const boardId = board && board.id ? board.id : ''
        setPreview({ loading: true, boardId })
        try {
          const result = await call('artifact', { path: artifactText, boardId })
          if (result && result.kind === 'url' && result.url) {
            try {
              window.open(result.url, '_blank', 'noopener')
              setPreview(null)
              return
            } catch {
              /* 保留弹层降级 */
            }
          }
          setPreview({ result, boardId })
        } catch (caught) {
          setPreview({ error: caught && caught.message ? caught.message : String(caught), boardId })
        }
      }, [])

      const previewPath = useCallback(
        (path, boardId) => openPreview(path, { id: boardId }),
        [openPreview],
      )

      const refresh = useCallback(async () => {
        try {
          setState(await call('state'))
          setError('')
        } catch (caught) {
          setError(caught && caught.message ? caught.message : String(caught))
        }
      }, [])

      useEffect(() => {
        aliveRef.current = true
        const tick = () => {
          if (aliveRef.current) refresh()
        }
        tick()
        const timer = window.setInterval(tick, 3000)
        return () => {
          aliveRef.current = false
          window.clearInterval(timer)
        }
      }, [refresh])

      const manualRefresh = async () => {
        setBusy(true)
        try {
          await refresh()
        } finally {
          setBusy(false)
        }
      }

      const stats = state && state.stats ? state.stats : { total: 0, working: 0, done: 0, archived: 0 }
      const allBoards = state && Array.isArray(state.boards) ? state.boards : []
      const activeCount = allBoards.filter((b) => !b.archived && b.status !== 'done').length
      const doneCount = allBoards.filter((b) => !b.archived && b.status === 'done').length
      const archivedCount = allBoards.filter((b) => b.archived).length
      const tabMeta = {
        active: { count: activeCount, empty: t('emptyActive') },
        done: { count: doneCount, empty: t('emptyDone') },
        archived: { count: archivedCount, empty: t('emptyArchived') },
      }
      // v1.4 模糊搜索：query 按空白拆词，全部命中（忽略大小写、支持子串）才算命中。
      // 搜索范围：标题、需求、会话原始需求、处理/交付清单的标题/详情/结果/产物/负责人。
      const q = query.trim().toLowerCase()
      const searchText = q ? q.split(/\s+/).filter(Boolean) : []
      const matchesQuery = (b) => {
        if (!searchText.length) return true
        const items = [...(b.processing || []), ...(b.delivery || [])]
        const haystack = [
          b.title, b.requirement, b.sessionDemand, b.status,
          ...items.flatMap((it) => [it.title, it.detail, it.result, it.artifact, it.owner]),
        ].filter(Boolean).join('\n').toLowerCase()
        return searchText.every((word) => haystack.includes(word))
      }
      const boards = allBoards.filter((b) => {
        if (tab === 'archived') { if (!b.archived) return false }
        else if (b.archived) return false
        else if (tab === 'done' ? b.status !== 'done' : b.status === 'done') return false
        return matchesQuery(b)
      })
      const searching = searchText.length > 0

      return h(
        'div',
        { className: 'dtb-page' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h(
          'div',
          { className: 'dtb-inner' },
          h(
            'div',
            { className: 'dtb-head' },
            h(
              'div',
              null,
              h('h1', null, t('title')),
              h('p', null, t('subtitle')),
            ),
            h('div', { className: 'dtb-spacer' }),
            h('button', { className: 'dtb-btn', onClick: manualRefresh, disabled: busy }, t('refresh')),
          ),
          h(
            'div',
            { className: 'dtb-stats' },
            h('div', { className: 'dtb-stat' }, h('b', null, String(stats.total)), h('span', null, t('total'))),
            h('div', { className: 'dtb-stat' }, h('b', null, String(stats.working)), h('span', null, t('working'))),
            h('div', { className: 'dtb-stat' }, h('b', null, String(stats.done)), h('span', null, t('done'))),
            h('div', { className: 'dtb-stat' }, h('b', null, String(stats.archived)), h('span', null, t('archived'))),
          ),
          h(
            'div',
            { className: 'dtb-search' },
            h('span', { className: 'dtb-search-icon', 'aria-hidden': true }, '⌕'),
            h('input', {
              type: 'search',
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('search'),
              onChange: (e) => setQuery(e.target.value ? e.target.value : ''),
            }),
            query
              ? h('button', {
                  type: 'button',
                  className: 'dtb-search-clear',
                  title: t('clearSearch'),
                  'aria-label': t('clearSearch'),
                  onClick: () => setQuery(''),
                }, '×')
              : null,
          ),
          h(
            'div',
            { className: 'dtb-tabs' },
            ['active', 'done', 'archived'].map((key) =>
              h(
                'button',
                {
                  className: 'dtb-tab',
                  'data-active': String(tab === key),
                  key,
                  onClick: () => setTab(key),
                },
                t(key === 'active' ? 'tabActive' : key === 'done' ? 'tabDone' : 'tabArchived'),
                h('i', null, String(tabMeta[key].count)),
              ),
            ),
          ),
          error && !state
            ? h(
                'div',
                null,
                h('div', { className: 'dtb-error' }, `${t('loadFailed')}: ${error}`),
                h('button', { className: 'dtb-btn', onClick: manualRefresh }, t('retry')),
              )
            : !boards.length
              ? h('div', { className: 'dtb-empty' }, searching ? t('noMatch') : (state ? tabMeta[tab].empty : t('loading')))
              : h(
                  'div',
                  { className: 'dtb-list' },
                  boards.map((board) => h(BoardCard, { key: board.id, board, t, onPreview: openPreview, query })),
                ),
          preview
            ? h(PreviewModal, {
                preview,
                t,
                onClose: () => setPreview(null),
                onOpenPath: (path) => previewPath(path, preview.boardId),
              })
            : null,
        ),
      )
    }

    /** 错误边界：任何渲染异常都在面板内显示原因，避免整片空白。 */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        try {
          console.error('[dsh-task-board] render error', error)
        } catch {
          /* 忽略日志失败 */
        }
      }

      render() {
        const error = this.state.error
        if (error) {
          return h(
            'div',
            { className: 'dtb-page' },
            h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
            h(
              'div',
              { className: 'dtb-inner' },
              h('h1', { style: { margin: '24px 0 8px', fontSize: '18px' } }, '任务看板渲染出错'),
              h('div', { className: 'dtb-error' }, String((error && error.message) || error)),
              h(
                'div',
                { style: { marginTop: '14px' } },
                h('button', { className: 'dtb-btn', onClick: () => this.setState({ error: null }) }, '重试'),
              ),
            ),
          )
        }
        return this.props.children
      }
    }

    function BoardPanelSafe(props) {
      return h(PanelBoundary, null, h(BoardPanel, props))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-task-board: en dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-task-board: zh dictionary')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, BoardPanelSafe),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel'),
              locale: NS,
            },
            PanelIcon,
          ),
        )
      },
    }
  },
})
