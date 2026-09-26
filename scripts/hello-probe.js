// Read-only probe for the "accepts a connection but never answers" symptom:
// dial the link port, send a protocol version 1 hello, and report every frame
// that comes back inside the window.
import { WebSocket } from 'ws'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const port = Number(process.argv[2] ?? 48721)
const windowMs = Number(process.argv[3] ?? 8000)
const identityPath = path.join(homedir(), '.dsh', 'link', 'identity.json')
const identity = JSON.parse(readFileSync(identityPath, 'utf8'))
const publicKey = identity.publicKey

const started = Date.now()
const socket = new WebSocket(`ws://127.0.0.1:${port}`)
const frames = []

socket.on('open', () => {
  const line = `t+${Date.now() - started}ms open (WebSocket upgrade completed)`
  console.log(line)
  socket.send(JSON.stringify({
    type: 'hello',
    protocolVersion: 1,
    deviceId: '00000000-0000-4000-8000-000000000000',
    displayName: 'probe',
    publicKey,
    ephemeralPublicKey: publicKey,
  }))
  console.log(`t+${Date.now() - started}ms sent hello`)
})

socket.on('message', (data) => {
  const text = String(data)
  frames.push(text)
  const elapsed = Date.now() - started
  let summary = text.slice(0, 160)
  try {
    const message = JSON.parse(text)
    summary = `type=${message.type} listenPort=${message.listenPort} deviceId=${String(message.deviceId).slice(0, 8)}`
  } catch {}
  console.log(`t+${elapsed}ms frame: ${summary}`)
})

socket.on('error', (error) => console.log(`t+${Date.now() - started}ms error: ${error.message}`))
socket.on('close', (code, reason) => console.log(`t+${Date.now() - started}ms close code=${code} reason=${String(reason)}`))

await new Promise((resolve) => setTimeout(resolve, windowMs))
const firstHello = frames.length > 0 && JSON.parse(frames[0]).type === 'hello'
console.log(`--- ${windowMs}ms 窗口内收到 ${frames.length} 帧；首个是 hello: ${firstHello} ---`)
try { socket.close() } catch {}
process.exit(frames.length > 0 ? 0 : 1)
