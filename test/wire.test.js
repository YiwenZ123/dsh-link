import assert from 'node:assert/strict'
import test from 'node:test'
import { WebSocket } from 'ws'
import { generateIdentity } from '../src/keys.js'
import { chooseWinner, dial, listen } from '../src/wire.js'

test('the lexicographically smaller dialer wins when both sides dial', () => {
  assert.equal(chooseWinner({ localDeviceId: 'a', remoteDeviceId: 'b', localDialed: true }), 'local')
  assert.equal(chooseWinner({ localDeviceId: 'b', remoteDeviceId: 'a', localDialed: true }), 'remote')
  assert.equal(chooseWinner({ localDeviceId: 'b', remoteDeviceId: 'a', localDialed: false }), 'remote')
})

test('dial times out after 8 seconds when nothing accepts', async () => {
  const started = Date.now()
  await assert.rejects(dial({ host: '127.0.0.1', port: 1, timeoutMs: 200 }), /地址不可达/)
  assert.ok(Date.now() - started < 8_000)
})

test('listen binds an ephemeral port and receives one frame', async () => {
  const identity = generateIdentity({ displayName: 'mac', listenPort: 0 })
  let received = null
  const server = await listen(identity, (socket) => {
    socket.once('message', (data) => { received = String(data) })
  })
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  await new Promise((resolve) => socket.once('open', resolve))
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.match(received, /"type":"hello"/)
  socket.close()
  await server.close()
})
