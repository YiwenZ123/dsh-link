// The dial-in side of a connection: what our peer record ends up with when the
// other machine is the one that dialed, and what a peer whose hello carries no
// listenPort (an older release) still gets.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { generateIdentity } from '../src/keys.js'
import { createIdentityStore } from '../src/identity-store.js'
import { createPeerStore } from '../src/peer-store.js'
import { startLinkService, __portToDial } from '../src/link-service.js'

const ANNOUNCED_PORT = 51515
const SOURCE_PORT = 51234

async function tempHome() {
  return mkdtemp(path.join(tmpdir(), 'dsh-link-hello-'))
}

async function waitFor(fn, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return fn()
}

/** A signed-in-advance identity so the announced port is a known value. */
async function seedIdentity(home, listenPort) {
  const identity = generateIdentity({ displayName: 'caller', listenPort })
  await createIdentityStore(home).save(identity)
  return identity
}

/** Pair through the public API: `pair()` dials, the acceptor approves. */
async function pairOverApi(acceptor, initiator) {
  const target = acceptor.snapshot().local.port
  await initiator.pair('127.0.0.1', target)
  const initiatorEntry = await waitFor(() => initiator.snapshot().pending[0])
  const acceptorEntry = await waitFor(() => acceptor.snapshot().pending[0])
  await acceptor.submitCode(acceptorEntry.deviceId, initiatorEntry.code)
  const peer = await waitFor(() => {
    const record = acceptor.snapshot().peers[0]
    return record?.status === 'connected' ? record : null
  })
  return { peer, initiatorEntry }
}

/**
 * Stand up a transparent frame relay in front of the acceptor and strip
 * `listenPort` out of every hello that crosses it, so the acceptor sees a
 * protocol version 1 hello from a release that predates the field.
 */
async function relayStrippingListenPort(targetPort) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  // Every socket this relay opened, so close() can tear them all down: a
  // lingering upstream client would keep the test process alive.
  const live = new Set()
  server.on('connection', (downstream) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${targetPort}`)
    live.add(downstream)
    live.add(upstream)
    // Frames can arrive before the upstream socket finishes connecting; hold
    // them instead of dropping them, or the hello is lost and pairing stalls.
    const queued = []
    upstream.on('open', () => {
      for (const text of queued.splice(0)) upstream.send(text)
    })
    const relay = (from, to, strip) => {
      from.on('message', (data) => {
        let text = String(data)
        if (strip) {
          const message = JSON.parse(text)
          if (message.type === 'hello') {
            delete message.listenPort
            text = JSON.stringify(message)
          }
        }
        if (to.readyState === 1) to.send(text)
        else if (to === upstream) queued.push(text)
      })
    }
    relay(downstream, upstream, true)
    relay(upstream, downstream, false)
    const closeBoth = () => {
      try { downstream.close() } catch {}
      try { upstream.close() } catch {}
    }
    downstream.on('close', closeBoth)
    downstream.on('error', closeBoth)
    upstream.on('close', closeBoth)
    upstream.on('error', closeBoth)
  })
  return {
    port: server.address().port,
    close: async () => {
      for (const socket of live) {
        try { socket.terminate() } catch {}
      }
      live.clear()
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

test('a dial-in pairing records the announced listenPort, not the dialing source port', async () => {
  const acceptorHome = await tempHome()
  const initiatorHome = await tempHome()
  await seedIdentity(initiatorHome, ANNOUNCED_PORT)
  const acceptor = await startLinkService({ home: acceptorHome, listenPort: 0 })
  const initiator = await startLinkService({ home: initiatorHome, listenPort: 0 })
  try {
    const { peer } = await pairOverApi(acceptor, initiator)
    // The initiator listens on its own stable port and dials from an
    // OS-assigned source port; the acceptor must record the former.
    assert.equal(peer.lastPort, ANNOUNCED_PORT)
    assert.equal(peer.lastPort, initiator.snapshot().local.port)
  } finally {
    await initiator.stop()
    await acceptor.stop()
    await rm(initiatorHome, { recursive: true, force: true })
    await rm(acceptorHome, { recursive: true, force: true })
  }
})

test('a successful connection persists the peer to disk with the failure cleared', async () => {
  const acceptorHome = await tempHome()
  const initiatorHome = await tempHome()
  await seedIdentity(initiatorHome, ANNOUNCED_PORT)
  const acceptor = await startLinkService({ home: acceptorHome, listenPort: 0 })
  const initiator = await startLinkService({ home: initiatorHome, listenPort: 0 })
  try {
    await pairOverApi(acceptor, initiator)
    const deviceId = initiator.snapshot().local.deviceId
    const stored = await waitFor(async () => {
      const record = await createPeerStore(acceptorHome).get(deviceId)
      return record?.lastPort === ANNOUNCED_PORT ? record : null
    })
    assert.equal(stored.lastPort, ANNOUNCED_PORT)
    assert.equal(stored.listenPort, ANNOUNCED_PORT)
    assert.equal(stored.failure, null)
    assert.equal(stored.failed, false)
    assert.equal(stored.hadConnected, true)
  } finally {
    await initiator.stop()
    await acceptor.stop()
    await rm(initiatorHome, { recursive: true, force: true })
    await rm(acceptorHome, { recursive: true, force: true })
  }
})

test('a version 1 peer whose hello has no listenPort still pairs and reconnects', async () => {
  const acceptorHome = await tempHome()
  const initiatorHome = await tempHome()
  const acceptor = await startLinkService({ home: acceptorHome, listenPort: 0 })
  const initiator = await startLinkService({ home: initiatorHome, listenPort: 0 })
  const relay = await relayStrippingListenPort(acceptor.snapshot().local.port)
  try {
    // Dial through the relay: the acceptor never sees a listenPort.
    await initiator.pair('127.0.0.1', relay.port)
    const initiatorEntry = await waitFor(() => initiator.snapshot().pending[0])
    const acceptorEntry = await waitFor(() => acceptor.snapshot().pending[0])
    const sourcePort = acceptorEntry.port
    await acceptor.submitCode(acceptorEntry.deviceId, initiatorEntry.code)
    const peer = await waitFor(() => {
      const record = acceptor.snapshot().peers[0]
      return record?.status === 'connected' ? record : null
    })
    // Nothing was announced on the wire, so all the acceptor has is the peer
    // port the socket showed — the fallback path, never a refusal. (The
    // in-band port from the strip-less hello is what it would otherwise use.)
    assert.equal(peer.lastPort, sourcePort)
    assert.equal((await createPeerStore(acceptorHome).get(peer.deviceId)).hadConnected, true)
  } finally {
    await relay.close()
    await initiator.stop()
    await acceptor.stop()
    await rm(initiatorHome, { recursive: true, force: true })
    await rm(acceptorHome, { recursive: true, force: true })
  }
})

test('a redial prefers the announced listener over a stored source port', () => {
  // A dial-in peer leaves its ephemeral source port in `lastPort`; the
  // announced listener is the address that will answer.
  assert.equal(__portToDial({ lastPort: SOURCE_PORT, listenPort: ANNOUNCED_PORT }), ANNOUNCED_PORT)
  assert.equal(__portToDial({ lastPort: SOURCE_PORT }, undefined, ANNOUNCED_PORT), ANNOUNCED_PORT)
  // The announce from the connection that just dropped is fresher than the
  // record on disk, so it wins over the stored announce.
  assert.equal(__portToDial({ lastPort: SOURCE_PORT, listenPort: 48721 }, undefined, ANNOUNCED_PORT), ANNOUNCED_PORT)
  // Without any announce, the stored port is all a version 1 peer ever gave.
  assert.equal(__portToDial({ lastPort: 48721 }), 48721)
  assert.equal(__portToDial({ lastPort: SOURCE_PORT }), SOURCE_PORT)
  // A port a connection actually completed on outranks every hint and guess.
  assert.equal(__portToDial({ lastPort: SOURCE_PORT }, 4242, ANNOUNCED_PORT), 4242)
  assert.equal(__portToDial({ lastPort: 48721 }, 4242), 4242)
})

test('the stored listener is preferred over a stale ephemeral lastPort', () => {
  // What a record looks like after a dial-in pairing: lastPort holds the
  // source port, listenPort holds the listener the hello announced.
  assert.equal(__portToDial({ lastPort: 51234, listenPort: 64955 }), 64955)
  // Once a redial succeeds, lastPort is the listener too and both agree.
  assert.equal(__portToDial({ lastPort: 64955, listenPort: 64955 }), 64955)
})
