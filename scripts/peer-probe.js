// Read-only probe of the PEER side: dial the Mac's link port, send this
// machine's real identity in a hello, and report every frame that comes back.
// This is only a WebSocket client — it never touches the pair record.
import { WebSocket } from 'ws'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const host = process.argv[2] ?? '192.168.3.118'
const port = Number(process.argv[3] ?? 64955)
const windowMs = Number(process.argv[4] ?? 12000)
const identity = JSON.parse(readFileSync(path.join(homedir(), '.dsh', 'link', 'identity.json'), 'utf8'))

const started = Date.now()
const stamp = () => `t+${Date.now() - started}ms`
const socket = new WebSocket(`ws://${host}:${port}`)
let frames = 0

socket.on('open', () => {
  console.log(`${stamp()} open (upgrade OK)`)
  socket.send(JSON.stringify({
    type: 'hello',
    protocolVersion: 1,
    deviceId: identity.deviceId,
    displayName: identity.displayName,
    publicKey: identity.publicKey,
    ephemeralPublicKey: identity.publicKey,
    listenPort: identity.listenPort,
  }))
  console.log(`${stamp()} sent hello (deviceId=${identity.deviceId.slice(0, 8)}, listenPort=${identity.listenPort})`)
})

socket.on('message', (data) => {
  frames += 1
  const text = String(data)
  try {
    const message = JSON.parse(text)
    console.log(`${stamp()} frame: ${JSON.stringify(message).slice(0, 200)}`)
  } catch {
    console.log(`${stamp()} frame (non-JSON): ${text.slice(0, 120)}`)
  }
})

socket.on('error', (error) => console.log(`${stamp()} error: ${error.message}`))
socket.on('close', (code, reason) => console.log(`${stamp()} close code=${code} reason=${String(reason)}`))

await new Promise((resolve) => setTimeout(resolve, windowMs))
console.log(`--- ${windowMs}ms 内收到 ${frames} 帧 ---`)
try { socket.close() } catch {}
process.exit(0)
