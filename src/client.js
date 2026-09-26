window.__ModuleLoader__.load({
  id: 'dsh-link',
  factory: (require) => {
    const jsx = require('react/jsx-runtime').jsx
    const React = require('react')
    const inject = ['slots', 'layout', 'locale']

    async function post(path, body) {
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    function LocalSection({ local }) {
      const [name, setName] = React.useState(local?.displayName || '')
      React.useEffect(() => { setName(local?.displayName || '') }, [local?.displayName])
      return jsx('section', {
        children: [
          jsx('h2', { children: '本机' }),
          jsx('div', { children: local ? `${local.displayName} ${local.shortId}:${local.port}` : '' }),
          jsx('label', {
            children: [
              jsx('input', {
                type: 'checkbox',
                checked: !!local?.discoverable,
                onChange: (e) => post('/dsh-link/discoverable', { value: e.target.checked }),
              }),
              '允许被局域网发现',
            ],
          }),
          jsx('input', {
            value: name,
            onChange: (e) => setName(e.target.value),
            placeholder: '本机名称',
          }),
          jsx('button', {
            onClick: () => post('/dsh-link/display-name', { name }),
            children: '保存名称',
          }),
        ],
      })
    }

    function PeerRow({ peer }) {
      return jsx('li', {
        children: [
          jsx('span', { children: `${peer.displayName} ${peer.deviceId.slice(0, 8)} — ${peer.status}` }),
          peer.failure ? jsx('span', { children: ` ${peer.failure}` }) : null,
          jsx('input', {
            type: 'checkbox',
            checked: !!peer.enabled,
            onChange: (e) => post('/dsh-link/switch', { deviceId: peer.deviceId, enabled: e.target.checked }),
          }),
          jsx('button', {
            onClick: () => post('/dsh-link/unpair', { deviceId: peer.deviceId }),
            children: '取消配对',
          }),
        ],
      })
    }

    function PeersSection({ peers }) {
      return jsx('section', {
        children: [
          jsx('h2', { children: '已记住的设备' }),
          jsx('ul', { children: (peers || []).map((peer) => jsx(PeerRow, { key: peer.deviceId, peer })) }),
        ],
      })
    }

    function NearbySection({ nearby }) {
      return jsx('section', {
        children: [
          jsx('h2', { children: '附近尚未配对的设备' }),
          jsx('ul', {
            children: (nearby || []).map((device) => jsx('li', {
              key: device.deviceId,
              children: jsx('button', {
                onClick: () => post('/dsh-link/pair', { host: device.host, port: device.port }),
                children: `${device.displayName} ${device.deviceId.slice(0, 8)}`,
              }),
            })),
          }),
        ],
      })
    }

    function ManualSection() {
      const [host, setHost] = React.useState('')
      const [port, setPort] = React.useState('')
      return jsx('section', {
        children: [
          jsx('h2', { children: '手动地址' }),
          jsx('input', { value: host, onChange: (e) => setHost(e.target.value), placeholder: 'host' }),
          jsx('input', { value: port, onChange: (e) => setPort(e.target.value), placeholder: 'port' }),
          jsx('button', {
            onClick: () => post('/dsh-link/pair', { host, port: Number(port) }),
            children: '连接并配对',
          }),
        ],
      })
    }

    function PendingRow({ entry }) {
      const [code, setCode] = React.useState('')
      if (entry.role === 'initiator') {
        return jsx('div', {
          style: { fontSize: '2rem', fontWeight: 'bold' },
          children: entry.code
            ? `${entry.displayName || entry.deviceId.slice(0, 8)}: ${entry.code}`
            : `${entry.displayName || entry.deviceId.slice(0, 8)}: ——`,
        })
      }
      return jsx('div', {
        children: [
          jsx('span', { children: `${entry.displayName || entry.deviceId.slice(0, 8)} 想要配对` }),
          jsx('input', {
            value: code,
            maxLength: 6,
            pattern: '\\d{6}',
            onChange: (e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6)),
            placeholder: '6 位配对码',
          }),
          jsx('button', {
            onClick: () => post('/dsh-link/code', { deviceId: entry.deviceId, code }),
            children: '提交',
          }),
        ],
      })
    }

    function DevicesPanel() {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
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
      if (!state) return jsx('p', { children: '设备' })
      const pending = state.pending || []
      return jsx('div', {
        children: [
          pending.length > 0
            ? jsx('div', { children: pending.map((entry) => jsx(PendingRow, { key: entry.deviceId, entry })) })
            : null,
          jsx(LocalSection, { local: state.local }),
          jsx(PeersSection, { peers: state.peers }),
          jsx(NearbySection, { nearby: state.nearby }),
          jsx(ManualSection, {}),
        ],
      })
    }

    function apply(ctx) {
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
        return jsx('span', { children: '⧉' })
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
