import assert from 'node:assert/strict'
import test from 'node:test'
import { createSupervisor } from '../src/supervisor.js'

test('an enabled peer redials at 1s, 2s, 4s, then 15s', async () => {
  const waits = []
  const dials = []
  let clock = 0
  let lastDial = Promise.resolve()
  const timers = []
  const peers = [{ deviceId: 'b', enabled: true, lastHost: '10.0.0.2', lastPort: 9 }]
  const supervisor = createSupervisor({
    peers,
    dial: (peer) => {
      dials.push(clock)
      lastDial = Promise.reject(new Error('地址不可达'))
      return lastDial
    },
    now: () => clock,
    schedule: (fn, ms) => {
      waits.push(ms)
      const handle = { fn, ms }
      timers.push(handle)
      return handle
    },
    cancel: (handle) => { handle.cancelled = true },
  })
  supervisor.noteDropped('b')
  for (const expected of [1000, 2000, 4000, 15000]) {
    assert.equal(waits.at(-1), expected)
    clock += expected
    timers.at(-1).fn()
    await lastDial.catch(() => {})
  }
  supervisor.setEnabled('b', false)
  assert.equal(timers.at(-1).cancelled, true)
  assert.equal(dials.length, 4)
  supervisor.stop()
})

test('a new address while connected updates the record and does not dial', async () => {
  const dials = []
  const peers = [{ deviceId: 'b', enabled: true, lastHost: 'old', lastPort: 1 }]
  const supervisor = createSupervisor({
    peers,
    dial: (peer) => { dials.push(peer.lastHost); return Promise.resolve() },
    now: () => 0,
    schedule: () => ({ cancelled: false }),
    cancel: (handle) => { handle.cancelled = true },
  })
  supervisor.noteConnected('b')
  await supervisor.noteAddress('b', 'new', 2, true)
  assert.equal(peers[0].lastHost, 'new')
  assert.equal(dials.length, 0)
  await supervisor.noteAddress('b', 'newer', 3, false)
  assert.equal(dials.at(-1), 'newer')
})

test('a failed dial from a discovered address does not escape as an unhandled rejection', async () => {
  // mDNS hands the browse callback a new address and the callback has no try
  // around noteAddress. A rejection that escapes here reaches the plugin's
  // apply() as a fatal load failure, which takes the whole dsh process down.
  const rejections = []
  const onUnhandled = (reason) => rejections.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const peers = [{ deviceId: 'b', enabled: true, lastHost: 'old', lastPort: 1 }]
    const supervisor = createSupervisor({
      peers,
      dial: () => Promise.reject(new Error('地址不可达')),
      now: () => 0,
      schedule: () => ({ cancelled: false }),
      cancel: (handle) => { handle.cancelled = true },
    })
    await supervisor.noteAddress('b', 'new', 2, false)
    // The address is still recorded even though the dial failed.
    assert.equal(peers[0].lastHost, 'new')
    assert.equal(peers[0].lastPort, 2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(rejections, [])
    supervisor.stop()
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
