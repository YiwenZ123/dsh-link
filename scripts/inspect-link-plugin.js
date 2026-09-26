// Post-install smoke check for the running GUI: confirms both halves of the
// installed `dsh-link` plugin are live on a `dsh web` origin.
//
//   node scripts/inspect-link-plugin.js <port> [launch-token]
//
// The launch token is the `?token=…` from the URL `dsh web` printed at startup;
// without it only the unauthenticated `/dsh-link/*` host routes can be checked.
const port = process.argv[2] ?? '3080'
const token = process.argv[3]
const base = `http://127.0.0.1:${port}`

const state = await fetch(`${base}/dsh-link/state`)
const snapshot = await state.json()
console.log(`host route  GET /dsh-link/state -> ${state.status}`)
console.log(`local       ${snapshot.local.displayName} ${snapshot.local.shortId} port ${snapshot.local.port}`)
console.log(`peers       ${snapshot.peers.length}  nearby ${snapshot.nearby.length}  pending ${snapshot.pending.length}`)

if (token === undefined) {
  console.log('\nno launch token: skipping the browser half (the /plugins route needs the session cookie)')
  process.exit(0)
}

const exchanged = await fetch(`${base}/?token=${token}`, { redirect: 'manual' })
const cookie = (exchanged.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
const html = await (await fetch(`${base}/`, { headers: { cookie } })).text()
const marker = 'globalThis["__DSH_BOOT__"] = '
const at = html.indexOf(marker) + marker.length
const graph = JSON.parse(html.slice(at, html.indexOf('</script>', at)))
const row = graph.entries.find((entry) => entry.id === 'dsh-link')
console.log(`\nboot graph  ${graph.entries.length} entries, rev ${graph.rev}`)
console.log(`graph row   ${JSON.stringify(row)}`)
if (row === undefined) {
  console.error('browser half missing: no dsh-link row in window.__DSH_BOOT__')
  process.exit(1)
}

const bundle = await fetch(`${base}${row.url}`, { headers: { cookie } })
const source = await bundle.text()
const registration = source.indexOf('__ModuleLoader__.load')
console.log(`client.js   ${bundle.status} ${bundle.headers.get('content-type')} ${source.length} bytes`)
console.log(`registers   ${JSON.stringify(source.slice(registration, registration + 40))}`)
console.log(`panel       sidebar.panellist ${source.includes("'sidebar.panellist'")}, main key devices ${source.includes("key: 'devices'")}`)
