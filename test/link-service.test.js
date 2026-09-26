import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
    await waitFor(() => left.snapshot().peers[0]?.status === 'connected')
    assert.equal(left.snapshot().peers[0].status, 'connected')
    const peerId = left.snapshot().peers[0].deviceId
    await left.stop()
    await right.stop()
    const leftAgain = await startLinkService({ home: leftHome, listenPort: 0 })
    const rightAgain = await startLinkService({ home: rightHome, listenPort: 0 })
    try {
      await leftAgain.setEnabled(peerId, true)
      await waitFor(() => leftAgain.snapshot().peers.find((peer) => peer.deviceId === peerId)?.status === 'connected')
      assert.equal(leftAgain.snapshot().peers.find((peer) => peer.deviceId === peerId).status, 'connected')
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
    await waitFor(() => left.snapshot().peers[0]?.status === 'connected')
    const peerId = left.snapshot().peers[0].deviceId
    await left.setEnabled(peerId, false)
    assert.equal(left.snapshot().peers[0].status, 'disabled')
    await left.setEnabled(peerId, true)
    await waitFor(() => left.snapshot().peers[0]?.status === 'connected')
    assert.equal(left.snapshot().peers[0].status, 'connected')
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
