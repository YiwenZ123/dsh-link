import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

function spawnLink(home) {
  const child = spawn(process.execPath, ['scripts/link-process.js'], {
    env: { ...process.env, DSH_LINK_HOME: home, DSH_LINK_PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const ready = new Promise((resolve, reject) => {
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const line = buffer.split('\n').find((item) => item.startsWith('{'))
      if (line) resolve(JSON.parse(line))
    })
    child.once('exit', (code) => reject(new Error(`exit ${code}`)))
  })
  return { child, ready }
}

test('two OS processes pair and survive a restart', async () => {
  const leftHome = await mkdtemp(path.join(tmpdir(), 'dsh-link-proc-'))
  const rightHome = await mkdtemp(path.join(tmpdir(), 'dsh-link-proc-'))
  const right = spawnLink(rightHome)
  const rightReady = await right.ready
  const left = spawnLink(leftHome)
  await left.ready
  const paired = await fetch(`http://127.0.0.1:${(await left.ready).uiPort}/dsh-link/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1', port: rightReady.port }),
  })
  const leftState = await paired.json()
  const code = leftState.pending[0].code
  const rightState = await (await fetch(`http://127.0.0.1:${rightReady.uiPort}/dsh-link/state`)).json()
  await fetch(`http://127.0.0.1:${rightReady.uiPort}/dsh-link/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: rightState.pending[0].deviceId, code }),
  })
  left.child.kill()
  right.child.kill()
  const leftAgain = spawnLink(leftHome)
  const rightAgain = spawnLink(rightHome)
  const leftReady = await leftAgain.ready
  const rightReadyAgain = await rightAgain.ready
  const state = await (await fetch(`http://127.0.0.1:${leftReady.uiPort}/dsh-link/state`)).json()
  const peer = state.peers[0]
  await fetch(`http://127.0.0.1:${leftReady.uiPort}/dsh-link/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: peer.deviceId, enabled: true }),
  })
  const deadline = Date.now() + 2000
  let after
  do {
    after = await (await fetch(`http://127.0.0.1:${leftReady.uiPort}/dsh-link/state`)).json()
    if (after.peers[0]?.status === 'connected') break
    await new Promise((resolve) => setTimeout(resolve, 50))
  } while (Date.now() < deadline)
  assert.equal(after.peers[0].status, 'connected')
  assert.ok(rightReadyAgain.port > 0)
  leftAgain.child.kill()
  rightAgain.child.kill()
  await rm(leftHome, { recursive: true, force: true })
  await rm(rightHome, { recursive: true, force: true })
})
