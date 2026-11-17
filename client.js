/**
 * Browser half of the task-board bundle: one entry in the left sidebar
 * (`sidebar.panellist`) and the full-width panel it selects (`main`).
 *
 * The panel polls the host HTTP API written by index.js. It only reads state;
 * the writing path is the agent tools, so what you see is what the agent recorded.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-task-board',
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
      loading: 'Loading…',
      loadFailed: 'Cannot reach the plugin backend',
      retry: 'Retry',
      empty: 'No task board yet. After you dispatch a task, the agent will create one automatically.',
      total: 'Tasks',
      working: 'In progress',
      done: 'Done',
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
      loading: '加载中…',
      loadFailed: '连不上插件后端',
      retry: '重试',
      empty: '还没有任务看板。分发任务后，智能体会自动建立处理清单和交付清单。',
      total: '任务',
      working: '进行中',
      done: '已完成',
      requirement: '需求',
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
      '.dtb-bar{width:88px;height:5px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;flex:none}',
      '.dtb-bar i{display:block;height:100%;background:var(--dsw-alias-brand-primary)}',
      '.dtb-meta{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dtb-body{border-top:1px solid var(--dsw-alias-border-l1);padding:14px 16px 18px;display:flex;flex-direction:column;gap:14px}',
      '.dtb-req{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;',
      'padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}',
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
      }
      return map[status] || status || ''
    }

    function Item({ item, t, kind }) {
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
        item.artifact ? h('div', { className: 'dtb-artifact' }, `${t('artifact')}：${item.artifact}`) : null,
      )
    }

    function Section({ title, items, t, kind }) {
      return h(
        'div',
        { className: 'dtb-sec' },
        h('h3', null, title, h('span', null, `${items.length}`)),
        items.length
          ? h(
              'div',
              { className: 'dtb-items' },
              items.map((item) => h(Item, { key: item.id || item.title, item, t, kind })),
            )
          : h('div', { className: 'dtb-empty' }, t('noItems')),
      )
    }

    function BoardCard({ board, t }) {
      const [open, setOpen] = useState(true)
      const p = board.progress || { total: 0, done: 0, percent: 0 }
      const updated = board.updatedAt
        ? new Date(board.updatedAt).toLocaleString()
        : ''
      return h(
        'div',
        { className: 'dtb-card' },
        h(
          'div',
          { className: 'dtb-card-head', onClick: () => setOpen((v) => !v) },
          h('span', { className: 'dtb-card-title' }, board.title),
          h('span', { className: 'dtb-badge', 'data-s': board.status }, statusText(t, board.status)),
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
              board.requirement
                ? h('div', { className: 'dtb-req' }, h('b', null, `${t('requirement')}：`), board.requirement)
                : null,
              h(
                'div',
                { className: 'dtb-cols' },
                h(Section, { title: t('processing'), items: board.processing || [], t, kind: 'processing' }),
                h(Section, { title: t('delivery'), items: board.delivery || [], t, kind: 'delivery' }),
              ),
            )
          : null,
      )
    }

    function BoardPanel(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackText
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const aliveRef = useRef(true)

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

      const stats = state && state.stats ? state.stats : { total: 0, working: 0, done: 0 }
      const boards = state && Array.isArray(state.boards) ? state.boards : []

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
          ),
          error && !state
            ? h(
                'div',
                null,
                h('div', { className: 'dtb-error' }, `${t('loadFailed')}: ${error}`),
                h('button', { className: 'dtb-btn', onClick: manualRefresh }, t('retry')),
              )
            : !boards.length
              ? h('div', { className: 'dtb-empty' }, state ? t('empty') : t('loading'))
              : h(
                  'div',
                  { className: 'dtb-list' },
                  boards.map((board) => h(BoardCard, { key: board.id, board, t })),
                ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-task-board: en dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-task-board: zh dictionary')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, BoardPanel),
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
