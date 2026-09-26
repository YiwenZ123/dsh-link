import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startLinkService, __resolveCollision } from '../src/link-service.js'

async function tempHome() {
  return mkdtemp(path.join(tmpdir(), 'dsh-link-home-'))
}

async function waitFor(fn, ms = 2000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const result = fn()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return fn()
}

/**
 * Wait for a peer to report connected and return that record. A reconnect can
 * spend up to one backoff interval (1s) between a failed dial and the retry,
 * so asserting on a later snapshot instead of this return value reads
 * `failed`/`reconnecting` on a slow machine.
 * @param service - the running link service.
 * @param deviceId - the peer to watch, or the first peer when omitted.
 * @param ms - how long to wait before giving up.
 * @returns the connected peer record.
 */
async function waitForConnected(service, deviceId, ms = 6000) {
  const peer = await waitFor(() => {
    const record = deviceId === undefined
      ? service.snapshot().peers[0]
      : service.snapshot().peers.find((item) => item.deviceId === deviceId)
    return record?.status === 'connected' ? record : null
  }, ms)
  assert.ok(peer, `peer ${deviceId ?? ''} never reached connected`)
  return peer
}

test('two services pair, restart, and reconnect from the switch without a new code', async () => {
  const leftHome = await tempHome()
  const rightHome = await tempHome()
  const left = await startLinkService({ home: leftHome, listenPort: 0 })
  const right = await startLinkService({ home: rightHome, listenPort: 0 })
  try {
    await left.pair('127.0.0.1', right.snapshot().local.port === left.snapshot().local.port
      ? right.snapshot().local.port
      : right.snapshot().local.port)
    const pending = await waitFor(() => left.snapshot().pending[0]?.code ? left.snapshot().pending[0] : null)
    assert.match(pending.code, /^\d{6}$/)
    const rightPending = await waitFor(() => right.snapshot().pending[0] ? right.snapshot().pending[0] : null)
    await right.submitCode(rightPending.deviceId, pending.code)
    const connected = await waitForConnected(left)
    const peerId = connected.deviceId
    await left.stop()
    await right.stop()
    const leftAgain = await startLinkService({ home: leftHome, listenPort: 0 })
    const rightAgain = await startLinkService({ home: rightHome, listenPort: 0 })
    try {
      await leftAgain.setEnabled(peerId, true)
      await waitForConnected(leftAgain, peerId)
      assert.equal(leftAgain.snapshot().pending.length, 0)
    } finally {
      await leftAgain.stop()
      await rightAgain.stop()
    }
  } finally {
    await rm(leftHome, { recursive: true, force: true })
    await rm(rightHome, { recursive: true, force: true })
  }
})

test('a wrong code does not create a peer', async () => {
  const leftHome = await tempHome()
  const rightHome = await tempHome()
  const left = await startLinkService({ home: leftHome, listenPort: 0 })
  const right = await startLinkService({ home: rightHome, listenPort: 0 })
  try {
    await left.pair('127.0.0.1', right.snapshot().local.port)
    const pending = await waitFor(() => left.snapshot().pending[0]?.code ? left.snapshot().pending[0] : null)
    const rightPending = await waitFor(() => right.snapshot().pending[0] ? right.snapshot().pending[0] : null)
    const wrong = pending.code === '000000' ? '000001' : '000000'
    await right.submitCode(rightPending.deviceId, wrong)
    await waitFor(() => right.snapshot().peers.length === 0 && left.snapshot().peers.length === 0)
    assert.equal(right.snapshot().peers.length, 0)
    assert.equal(left.snapshot().peers.length, 0)
  } finally {
    await left.stop()
    await right.stop()
    await rm(leftHome, { recursive: true, force: true })
    await rm(rightHome, { recursive: true, force: true })
  }
})

test('switching off closes the socket and switching on connects again', async () => {
  const leftHome = await tempHome()
  const rightHome = await tempHome()
  const left = await startLinkService({ home: leftHome, listenPort: 0 })
  const right = await startLinkService({ home: rightHome, listenPort: 0 })
  try {
    await left.pair('127.0.0.1', right.snapshot().local.port)
    const pending = await waitFor(() => left.snapshot().pending[0]?.code ? left.snapshot().pending[0] : null)
    const rightPending = await waitFor(() => right.snapshot().pending[0] ? right.snapshot().pending[0] : null)
    await right.submitCode(rightPending.deviceId, pending.code)
    const peerId = (await waitForConnected(left)).deviceId
    await left.setEnabled(peerId, false)
    assert.equal(left.snapshot().peers[0].status, 'disabled')
    await left.setEnabled(peerId, true)
    await waitForConnected(left, peerId)
  } finally {
    await left.stop()
    await right.stop()
    await rm(leftHome, { recursive: true, force: true })
    await rm(rightHome, { recursive: true, force: true })
  }
})

test('resolveCollision keeps the socket dialed by the smaller deviceId', () => {
  const localDeviceId = '00000000-0000-4000-8000-000000000000'
  const remoteDeviceId = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
  const localDialed = { localDialed: true }
  const remoteDialed = { localDialed: false }
  // smaller-id side: conn is the local dial (outgoing), existing is the inbound.
  const { keeper: keptSmall } = __resolveCollision(localDeviceId, remoteDeviceId, localDialed, remoteDialed)
  assert.equal(keptSmall, localDialed)
  // larger-id side: conn is the inbound, existing is the local dial (outgoing).
  const { keeper: keptLarge } = __resolveCollision(remoteDeviceId, localDeviceId, remoteDialed, localDialed)
  assert.equal(keptLarge, remoteDialed)
})

test('a remembered peer with a mismatched public key ends with failure 密钥不符 and the saved key is unchanged', async () => {
  const leftHome = await tempHome()
  const rightHome = await tempHome()
  const right = await startLinkService({ home: rightHome, listenPort: 0 })
  try {
    const rightSnapshot = right.snapshot().local
    const wrongKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const { createPeerStore } = await import('../src/peer-store.js')
    const leftPeers = createPeerStore(leftHome)
    await leftPeers.put({
      deviceId: rightSnapshot.deviceId,
      displayName: rightSnapshot.displayName,
      publicKey: wrongKey,
      lastHost: '127.0.0.1',
      lastPort: rightSnapshot.port,
      enabled: true,
      pairedAt: Date.now(),
      hadConnected: false,
    })
    const left = await startLinkService({ home: leftHome, listenPort: 0 })
    try {
      await left.setEnabled(rightSnapshot.deviceId, true)
      await waitFor(() => {
        const peer = left.snapshot().peers[0]
        return peer?.failure === '密钥不符' ? peer : null
      }, 4000)
      const peer = left.snapshot().peers[0]
      assert.equal(peer.failure, '密钥不符')
      const saved = await createPeerStore(leftHome).get(rightSnapshot.deviceId)
      assert.equal(saved.publicKey, wrongKey)
    } finally {
      await left.stop()
    }
  } finally {
    await right.stop()
    await rm(leftHome, { recursive: true, force: true })
    await rm(rightHome, { recursive: true, force: true })
  }
})

test('snapshot peers includes failure when a dial fails with 地址不可达', async () => {
  const home = await tempHome()
  try {
    const { createPeerStore } = await import('../src/peer-store.js')
    const peers = createPeerStore(home)
    const targetId = '22222222-3333-4444-8555-666666666666'
    await peers.put({
      deviceId: targetId,
      displayName: 'ghost',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      lastHost: '127.0.0.1',
      lastPort: 1,
      enabled: true,
      pairedAt: Date.now(),
      hadConnected: false,
    })
    const service = await startLinkService({ home, listenPort: 0 })
    try {
      await service.setEnabled(targetId, true)
      await waitFor(() => {
        const peer = service.snapshot().peers[0]
        return peer?.failure === '地址不可达' ? peer : null
      }, 4000)
      const peer = service.snapshot().peers[0]
      assert.equal(peer.failure, '地址不可达')
    } finally {
      await service.stop()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a taken preferred port walks the stable range instead of an OS ephemeral one', async () => {
  const home = await tempHome()
  const attempts = []
  try {
    const { createIdentityStore } = await import('../src/identity-store.js')
    await createIdentityStore(home).save({
      deviceId: '11111111-2222-4333-8444-555555555555',
      displayName: 'win',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      listenPort: 48721,
      discoverable: true,
    })
    const service = await startLinkService({
      home,
      listenPort: 0,
      listenImpl: async (identity) => {
        attempts.push(identity.listenPort)
        if (identity.listenPort < 48723) {
          const error = new Error('listen EADDRINUSE: address already in use')
          error.code = 'EADDRINUSE'
          throw error
        }
        return { port: identity.listenPort, close: async () => {} }
      },
    })
    try {
      assert.deepEqual(attempts, [48721, 48722, 48723])
      assert.equal(service.snapshot().local.port, 48723)
      assert.equal((await createIdentityStore(home).load()).listenPort, 48723)
    } finally {
      await service.stop()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a first run without a saved port starts at the default instead of an ephemeral port', async () => {
  const home = await tempHome()
  const attempts = []
  try {
    const service = await startLinkService({
      home,
      listenPort: 0,
      listenImpl: async (identity) => {
        attempts.push(identity.listenPort)
        return { port: identity.listenPort, close: async () => {} }
      },
    })
    try {
      assert.deepEqual(attempts, [48721])
    } finally {
      await service.stop()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the advertisement names the port that actually bound, even after a fallback', async () => {
  const home = await tempHome()
  const announced = []
  try {
    const { createMdns } = await import('../src/mdns.js')
    const mdns = createMdns({
      publish: (service) => { announced.push(service); return service },
      unpublish: () => {},
      browse: () => {},
      stopBrowse: () => {},
    })
    const service = await startLinkService({
      home,
      listenPort: 0,
      mdns,
      listenImpl: async (identity) => {
        // The whole stable range is taken, so the bind falls through to the
        // OS-assigned port — the advertisement must name that one, never the
        // port that failed to bind.
        if (identity.listenPort !== 0) {
          const error = new Error('listen EADDRINUSE: address already in use')
          error.code = 'EADDRINUSE'
          throw error
        }
        return { port: 61234, close: async () => {} }
      },
    })
    try {
      assert.equal(service.snapshot().local.port, 61234)
      assert.equal(announced.length, 1)
      assert.equal(announced[0].port, 61234)
      assert.equal(announced[0].txt.deviceId, service.snapshot().local.deviceId)
    } finally {
      await service.stop()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('nearby drops this machine itself and services whose address does not answer', async () => {
  const home = await tempHome()
  try {
    const { createMdns } = await import('../src/mdns.js')
    const { listen } = await import('../src/wire.js')
    const own = await listen({ listenPort: 0 }, () => {})
    const alive = await listen({ listenPort: 0 }, () => {})
    let emit = null
    const mdns = createMdns({
      publish: (service) => service,
      unpublish: () => {},
      browse: (_query, onService) => { emit = onService },
      stopBrowse: () => {},
    })
    const service = await startLinkService({ home, listenPort: 0, mdns })
    try {
      const local = service.snapshot().local
      emit({ host: '127.0.0.1', port: own.port, txt: { deviceId: local.deviceId, displayName: local.displayName, ver: '1' } })
      emit({ host: '127.0.0.1', port: alive.port, txt: { deviceId: 'aaaa1111-2222-4333-8444-555555555555', displayName: 'live', ver: '1' } })
      emit({ host: '127.0.0.1', port: 1, txt: { deviceId: 'bbbb1111-2222-4333-8444-555555555555', displayName: 'dead', ver: '1' } })
      const listed = await waitFor(() => service.snapshot().nearby.length === 1 && service.snapshot().nearby, 4000)
      assert.deepEqual(listed.map((device) => device.deviceId), ['aaaa1111-2222-4333-8444-555555555555'])
      assert.equal(service.snapshot().nearby.some((device) => device.deviceId === local.deviceId), false)
    } finally {
      await service.stop()
      await own.close()
      await alive.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a discovered address that stops answering does not take the host boot down', async () => {
  // Reproduces the Windows crash: the peer record points at an address that
  // no longer answers, mDNS discovers that peer, and the browse callback dials
  // it. The rejection used to escape as an unhandled rejection, which surfaced
  // in the plugin's apply() as `fatal load failure` and killed the whole dsh
  // process — no listen port, no advertisement, nothing to reconnect to.
  const home = await tempHome()
  const rejections = []
  const onUnhandled = (reason) => rejections.push(reason)
  process.on('unhandledRejection', onUnhandled)
  let service
  try {
    const { createMdns } = await import('../src/mdns.js')
    const peerId = 'cccc1111-2222-4333-8444-555555555555'
    const peersDir = path.join(home, 'peers')
    await mkdir(peersDir, { recursive: true })
    await writeFile(path.join(peersDir, `${peerId}.json`), JSON.stringify({
      deviceId: peerId,
      displayName: 'gone',
      publicKey: 'x',
      lastHost: '127.0.0.1',
      lastPort: 1,
      enabled: true,
      pairedAt: Date.now(),
      hadConnected: true,
      failed: false,
      failure: null,
    }))

    let emit = null
    const mdns = createMdns({
      publish: (service_) => service_,
      unpublish: () => {},
      browse: (_query, onService) => { emit = onService },
      stopBrowse: () => {},
    })
    // The boot itself must complete: a dial failure may not reach apply().
    service = await startLinkService({
      home,
      listenPort: 0,
      mdns,
      dialImpl: () => Promise.reject(new Error('地址不可达')),
    })
    emit({
      host: '127.0.0.1',
      port: 1,
      txt: { deviceId: peerId, displayName: 'gone', ver: '1' },
    })
    await waitFor(() => service.snapshot().peers[0]?.lastPort === 1, 2000)
    assert.equal(service.snapshot().peers[0].lastHost, '127.0.0.1')
    // A known peer is never offered as a nearby candidate to pair with.
    assert.equal(service.snapshot().nearby.length, 0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.deepEqual(rejections, [])
  } finally {
    if (service) await service.stop()
    await rm(home, { recursive: true, force: true })
    process.off('unhandledRejection', onUnhandled)
  }
})

test('switching a peer off survives the peer dialing back in', async () => {
  // Turning the switch off closes the socket, the peer notices the drop and
  // dials straight back. That inbound connection used to write `enabled: true`
  // unconditionally, so the switch flipped itself back on within a second and
  // the user could not keep a peer off.
  const leftHome = await tempHome()
  const rightHome = await tempHome()
  const left = await startLinkService({ home: leftHome, listenPort: 0 })
  const right = await startLinkService({ home: rightHome, listenPort: 0 })
  try {
    await left.pair('127.0.0.1', right.snapshot().local.port)
    const pending = await waitFor(() => left.snapshot().pending[0]?.code ? left.snapshot().pending[0] : null)
    const rightPending = await waitFor(() => right.snapshot().pending[0] ? right.snapshot().pending[0] : null)
    await right.submitCode(rightPending.deviceId, pending.code)
    const peerId = (await waitForConnected(left)).deviceId

    await left.setEnabled(peerId, false)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    assert.equal(left.snapshot().peers[0].enabled, false)
    assert.equal(left.snapshot().peers[0].status, 'disabled')
    const onDisk = JSON.parse(await readFile(path.join(leftHome, 'peers', `${peerId}.json`), 'utf8'))
    assert.equal(onDisk.enabled, false)
  } finally {
    await left.stop()
    await right.stop()
    await rm(leftHome, { recursive: true, force: true })
    await rm(rightHome, { recursive: true, force: true })
  }
})
