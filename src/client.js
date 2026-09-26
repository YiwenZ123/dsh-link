window.__ModuleLoader__.load({
  id: 'dsh-link',
  factory: (require) => {
    const { jsx, jsxs } = require('react/jsx-runtime')
    const React = require('react')
    const inject = ['slots', 'layout', 'locale']

    const CSS = `
.dshlink{box-sizing:border-box;height:100%;overflow:auto;padding:28px 32px 48px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);background:var(--dsw-alias-bg-base)}
.dshlink *{box-sizing:border-box}
.dshlink-page{max-width:680px;display:flex;flex-direction:column;gap:22px}
.dshlink-kicker{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:560;letter-spacing:.04em}
.dshlink-card{padding:16px 16px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dshlink-stack{display:flex;flex-direction:column;gap:12px}
.dshlink-line{display:flex;align-items:center;gap:10px;min-width:0}
.dshlink-grow{flex:1;min-width:0}
.dshlink-name{margin:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.dshlink-meta{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-markdown-code-font-family),ui-monospace,monospace;font-size:12px}
.dshlink-input{height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;outline:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;font-size:13px}
.dshlink-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dshlink-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dshlink-port{width:92px;flex:none}
.dshlink-btn{height:34px;padding:0 12px;border:1px solid transparent;border-radius:9px;cursor:pointer;font:inherit;font-size:13px;font-weight:560}
.dshlink-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshlink-btn-primary{color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-button-primary-fill)}
.dshlink-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}
.dshlink-btn-ghost{color:var(--dsw-alias-label-secondary);background:transparent;border-color:var(--dsw-alias-border-l3)}
.dshlink-btn-ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshlink-btn-danger{color:var(--dsw-alias-state-error-primary);background:transparent;border-color:transparent}
.dshlink-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.dshlink-switch{position:relative;width:36px;height:22px;flex:none}
.dshlink-switch input{position:absolute;z-index:1;width:100%;height:100%;margin:0;cursor:pointer;opacity:0}
.dshlink-switch i{display:block;height:22px;border:1px solid var(--dsw-alias-border-l3);border-radius:99px;background:var(--dsw-alias-bg-layer-3);pointer-events:none}
.dshlink-switch i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s ease}
.dshlink-switch input:checked+i{border-color:transparent;background:var(--dsw-alias-button-primary-fill)}
.dshlink-switch input:checked+i::after{transform:translateX(14px);background:var(--dsw-alias-label-primary-inverted)}
.dshlink-switch input:focus-visible+i{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshlink-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:4px}
.dshlink-setting span{color:var(--dsw-alias-label-secondary);font-size:13px}
.dshlink-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dshlink-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dshlink-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
.dshlink-dot-on{background:var(--dsw-alias-state-success-primary)}
.dshlink-dot-wait{background:var(--dsw-alias-state-warn-primary)}
.dshlink-dot-bad{background:var(--dsw-alias-state-error-primary)}
.dshlink-fail{margin:2px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px}
.dshlink-empty{margin:0;color:var(--dsw-alias-label-dimmed);font-size:13px}
.dshlink-plate{padding:18px 18px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
.dshlink-digits{display:flex;gap:8px;margin-top:10px}
.dshlink-digits span{width:42px;height:52px;display:grid;place-items:center;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-markdown-code-font-family),ui-monospace,monospace;font-size:26px;font-weight:620}
.dshlink-code-entry{display:flex;gap:8px;align-items:center;margin-top:12px}
.dshlink-code-entry .dshlink-input{width:148px;letter-spacing:.28em;font-family:var(--dsw-font-markdown-code-font-family),ui-monospace,monospace}
@media (prefers-reduced-motion: reduce){.dshlink-switch i::after{transition:none}}
`

    function ensureStyles() {
      if (document.getElementById('dsh-link-styles')) return
      const style = document.createElement('style')
      style.id = 'dsh-link-styles'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    async function post(path, body) {
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    function statusText(status) {
      return {
        disabled: '已关闭',
        connecting: '连接中',
        connected: '已连接',
        reconnecting: '重新连接',
        failed: '失败',
      }[status] || status || ''
    }

    function dotClass(status) {
      if (status === 'connected') return 'dshlink-dot dshlink-dot-on'
      if (status === 'connecting' || status === 'reconnecting') return 'dshlink-dot dshlink-dot-wait'
      if (status === 'failed') return 'dshlink-dot dshlink-dot-bad'
      return 'dshlink-dot'
    }

    function Switch({ checked, label, onChange }) {
      return jsxs('label', { className: 'dshlink-switch', children: [
        jsx('input', { type: 'checkbox', checked, 'aria-label': label, onChange }),
        jsx('i', {}),
      ] })
    }

    function LocalSection({ local }) {
      const [name, setName] = React.useState(local?.displayName || '')
      React.useEffect(() => { setName(local?.displayName || '') }, [local?.displayName])
      const dirty = name !== (local?.displayName || '')
      return jsxs('section', { className: 'dshlink-card dshlink-stack', children: [
        jsx('h2', { className: 'dshlink-kicker', children: '本机' }),
        jsxs('div', { className: 'dshlink-line', children: [
          jsx('input', {
            className: 'dshlink-input dshlink-grow',
            value: name,
            'aria-label': '本机名称',
            onChange: (e) => setName(e.target.value),
          }),
          jsx('button', {
            className: 'dshlink-btn dshlink-btn-ghost',
            disabled: !dirty,
            onClick: () => post('/dsh-link/display-name', { name }),
            children: '保存名称',
          }),
        ] }),
        jsx('p', { className: 'dshlink-meta', children: local ? `${local.shortId} · 端口 ${local.port}` : '' }),
        jsxs('div', { className: 'dshlink-setting', children: [
          jsx('span', { children: '允许被局域网发现' }),
          jsx(Switch, {
            checked: !!local?.discoverable,
            label: '允许被局域网发现',
            onChange: (e) => post('/dsh-link/discoverable', { value: e.target.checked }),
          }),
        ] }),
      ] })
    }

    function PeerRow({ peer }) {
      const address = peer.lastHost ? `${peer.lastHost}:${peer.lastPort}` : peer.deviceId.slice(0, 8)
      return jsxs('li', { className: 'dshlink-item', children: [
        jsx('span', { className: dotClass(peer.status), 'aria-hidden': 'true' }),
        jsxs('div', { className: 'dshlink-grow', children: [
          jsx('p', { className: 'dshlink-name', children: peer.displayName }),
          jsx('p', { className: 'dshlink-meta', children: `${statusText(peer.status)} · ${address}` }),
          peer.failure ? jsx('p', { className: 'dshlink-fail', children: peer.failure }) : null,
        ] }),
        jsx(Switch, {
          checked: !!peer.enabled,
          label: `${peer.displayName} 连接开关`,
          onChange: (e) => post('/dsh-link/switch', { deviceId: peer.deviceId, enabled: e.target.checked }),
        }),
        jsx('button', {
          className: 'dshlink-btn dshlink-btn-danger',
          onClick: () => post('/dsh-link/unpair', { deviceId: peer.deviceId }),
          children: '取消配对',
        }),
      ] })
    }

    function PeersSection({ peers }) {
      const rows = peers || []
      return jsxs('section', { className: 'dshlink-stack', children: [
        jsx('h2', { className: 'dshlink-kicker', children: '已记住的设备' }),
        rows.length === 0
          ? jsx('p', { className: 'dshlink-empty', children: '还没有记住的设备。配对成功后会出现在这里。' })
          : jsx('ul', { className: 'dshlink-list', children: rows.map((peer) => jsx(PeerRow, { peer }, peer.deviceId)) }),
      ] })
    }

    function NearbySection({ nearby }) {
      const rows = nearby || []
      return jsxs('section', { className: 'dshlink-stack', children: [
        jsx('h2', { className: 'dshlink-kicker', children: '附近尚未配对的设备' }),
        rows.length === 0
          ? jsx('p', { className: 'dshlink-empty', children: '局域网里还没有别的 DSH。可以改用下面的地址。' })
          : jsx('ul', { className: 'dshlink-list', children: rows.map((device) => jsxs('li', {
            className: 'dshlink-item',
            children: [
              jsxs('div', { className: 'dshlink-grow', children: [
                jsx('p', { className: 'dshlink-name', children: device.displayName }),
                jsx('p', { className: 'dshlink-meta', children: `${device.host}:${device.port}` }),
              ] }),
              jsx('button', {
                className: 'dshlink-btn dshlink-btn-ghost',
                onClick: () => post('/dsh-link/pair', { host: device.host, port: device.port }),
                children: '配对',
              }),
            ],
          }, device.deviceId)) }),
      ] })
    }

    function ManualSection() {
      const [host, setHost] = React.useState('')
      const [port, setPort] = React.useState('')
      return jsxs('section', { className: 'dshlink-stack', children: [
        jsx('h2', { className: 'dshlink-kicker', children: '手动地址' }),
        jsxs('div', { className: 'dshlink-line', children: [
          jsx('input', {
            className: 'dshlink-input dshlink-grow',
            value: host,
            placeholder: '主机',
            'aria-label': '主机',
            onChange: (e) => setHost(e.target.value),
          }),
          jsx('input', {
            className: 'dshlink-input dshlink-port',
            value: port,
            placeholder: '端口',
            inputMode: 'numeric',
            'aria-label': '端口',
            onChange: (e) => setPort(e.target.value),
          }),
          jsx('button', {
            className: 'dshlink-btn dshlink-btn-primary',
            onClick: () => post('/dsh-link/pair', { host, port: Number(port) }),
            children: '连接并配对',
          }),
        ] }),
      ] })
    }

    function PendingRow({ entry }) {
      const [code, setCode] = React.useState('')
      const who = entry.displayName || entry.deviceId.slice(0, 8)
      if (entry.role === 'initiator') {
        const digits = String(entry.code || '——————').slice(0, 6).split('')
        return jsxs('section', { className: 'dshlink-plate', children: [
          jsx('h2', { className: 'dshlink-kicker', children: `在 ${who} 上输入这组短码` }),
          jsx('div', { className: 'dshlink-digits', children: digits.map((digit, index) => jsx('span', { children: digit }, index)) }),
        ] })
      }
      return jsxs('section', { className: 'dshlink-plate', children: [
        jsx('h2', { className: 'dshlink-kicker', children: `${who} 正在请求配对` }),
        jsxs('div', { className: 'dshlink-code-entry', children: [
          jsx('input', {
            className: 'dshlink-input',
            value: code,
            maxLength: 6,
            inputMode: 'numeric',
            'aria-label': '6 位短码',
            placeholder: '6 位短码',
            onChange: (e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6)),
          }),
          jsx('button', {
            className: 'dshlink-btn dshlink-btn-primary',
            onClick: () => post('/dsh-link/code', { deviceId: entry.deviceId, code }),
            children: '确认',
          }),
        ] }),
      ] })
    }

    function DevicesPanel() {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        ensureStyles()
        let stopped = false
        async function pull() {
          try {
            const response = await fetch('/dsh-link/state')
            if (!stopped) setState(await response.json())
          } catch {}
        }
        pull()
        const timer = setInterval(pull, 1000)
        return () => { stopped = true; clearInterval(timer) }
      }, [])
      if (!state) {
        return jsx('div', { className: 'dshlink', children: jsx('p', { className: 'dshlink-empty', children: '正在读取这台机器…' }) })
      }
      const pending = state.pending || []
      return jsx('div', { className: 'dshlink', children: jsxs('div', { className: 'dshlink-page', children: [
        pending.map((entry) => jsx(PendingRow, { entry }, entry.deviceId)),
        jsx(LocalSection, { local: state.local }),
        jsx(PeersSection, { peers: state.peers }),
        jsx(NearbySection, { nearby: state.nearby }),
        jsx(ManualSection, {}),
      ] }) })
    }

    function apply(ctx) {
      ensureStyles()
      ctx.effect(() => ctx.locale.register('dsh-link', {
        zh: { 'panel.title': '设备' },
        en: { 'panel.title': 'Devices' },
      }))
      const t = ctx.locale.bind('dsh-link')
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'devices',
        order: 30,
        label: () => t('panel.title'),
        locale: 'dsh-link',
      }, function DevicesIcon() {
        return jsx('svg', {
          width: 18,
          height: 18,
          viewBox: '0 0 18 18',
          fill: 'none',
          'aria-hidden': 'true',
          children: jsx('path', {
            d: 'M4.5 6.5h6.2a2.3 2.3 0 1 0 0-1.6H4.5a2.3 2.3 0 1 0 0 1.6Zm9 6.6H7.3a2.3 2.3 0 1 0 0 1.6h6.2a2.3 2.3 0 1 0 0-1.6Z',
            fill: 'currentColor',
          }),
        })
      }))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'devices',
        locale: 'dsh-link',
      }, DevicesPanel))
    }
    return { apply, inject }
  },
})
