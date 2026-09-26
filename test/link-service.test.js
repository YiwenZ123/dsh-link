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
    await right.submitCode(pending.deviceId, pending.code)
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
    const wrong = pending.code === '000000' ? '000001' : '000000'
    await right.submitCode(pending.deviceId, wrong)
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
    await right.submitCode(pending.deviceId, pending.code)
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
