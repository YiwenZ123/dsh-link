# DSH Link 配对与连接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两台 DSH 用一次 6 位短码完成配对，之后记住设备，并在「设备」选项卡里开关连接。

**Architecture:** 同一个 `dsh-link` 包提供宿主服务和浏览器选项卡。宿主在自己的 WebSocket 端口上做 mDNS、手动拨号和 Ed25519 鉴权，不走浏览器 cookie。这一段不创建子代理会话；鉴权完成后的 `delegate.*` 与 `resume` 先被丢弃，下一份计划再接上。

**Tech Stack:** Node.js 22、`node:test`、`ws`、`bonjour-service`、Cordis 宿主插件、浏览器端 `window.__ModuleLoader__` 客户端插件。

## Global Constraints

- 协议版本是 `1`。不是 `1` 时状态为失败，原因是 `版本不一致`，委托接口关闭。第一次配对不写入设备记录；已经配对的设备保留记录。
- 默认监听端口是 `48721`。占用时改绑下一个可用端口，并写回身份记录。
- DNS-SD 服务类型是 `_dsh-link._tcp`。TXT 含 `deviceId`、显示名、协议版本 `1`。端口在 SRV。
- 身份文件是 `~/.dsh/link/identity.json`。已配对设备在 `~/.dsh/link/peers/`。私钥不进入仓库。
- 密钥算法是 Ed25519。
- 短码 6 位。规范 JSON 是键名按字母序、中间没有空白的 UTF-8。短码材料是发起方 hello、一个换行、接受方 hello，SHA-256 前 3 字节按大端解释后对 `1000000` 取模，左侧补零。
- 同一配对请求连续失败 `5` 次后锁定 `60000` 毫秒。
- 拨号超时 `8000` 毫秒，失败原因是 `地址不可达`。
- 开关仍开着时的重拨间隔是 `1000`、`2000`、`4000` 毫秒，最高 `15000` 毫秒。
- 单帧上限 `1048576` 字节。拼好的单条事件上限 `33554432` 字节，超过时诊断为 `事件过大`。
- 失败原因只有 `地址不可达`、`密钥不符`、`版本不一致`。
- 选项卡标题是 `设备`。本机 deviceId 只显示前 8 位。
- 拨号方是发起方。两边同时拨号时，保留 deviceId 字典序较小的一方发出的连接。
- 已经连着时，mDNS 新地址只更新记录，不拆当前连接。
- 这一段不能发起委托。

这一份只实现 spec 的「身份与配对」和「载波消息」里的帧规则，以及第 1 段验收。委托状态机、15 秒轮次等待、镜像子会话是后续计划，不在本文件里实现。

## File Structure

| 文件 | 职责 |
|---|---|
| `package.json` | 包名 `dsh-link`、`node:test` 脚本、`dsh.client` |
| `src/canonical-json.js` | 规范 JSON |
| `src/short-code.js` | 6 位短码 |
| `src/pairing-attempt.js` | 5 次失败与 1 分钟锁定 |
| `src/keys.js` | Ed25519 生成、签名、验签 |
| `src/identity-store.js` | 本机身份读写、端口占用时改绑 |
| `src/peer-store.js` | 已配对设备读写 |
| `src/frames.js` | 帧大小、阶段白名单、事件分片拼接 |
| `src/handshake.js` | hello、短码、互相鉴权 |
| `src/wire.js` | WebSocket 监听、拨号、8 秒超时、同时拨号取舍 |
| `src/supervisor.js` | 开关、退避重拨、地址更新 |
| `src/mdns.js` | 发布与浏览 `_dsh-link._tcp` |
| `src/link-service.js` | 把上面几块收成一份状态，供 HTTP 和测试使用 |
| `src/host-plugin.js` | Cordis `apply`，在 DSH 网页服务上注册 `/dsh-link/*` |
| `src/client.js` | 「设备」选项卡 |
| `test/*.test.js` | `node:test` |

---

### Task 1: 规范 JSON 与短码

**Files:**
- Create: `package.json`
- Create: `src/canonical-json.js`
- Create: `src/short-code.js`
- Test: `test/short-code.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `canonicalJson(value: unknown): string`；`shortCode(initiatorHello: object, acceptorHello: object): string`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJson } from '../src/canonical-json.js'
import { shortCode } from '../src/short-code.js'

test('canonical JSON sorts keys and drops whitespace', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
})

test('short code is six digits and independent of key order', () => {
  const left = { protocolVersion: 1, deviceId: 'a', displayName: 'A', publicKey: 'p', ephemeralPublicKey: 'e' }
  const right = { ephemeralPublicKey: 'f', publicKey: 'q', displayName: 'B', deviceId: 'b', protocolVersion: 1 }
  const code = shortCode(left, right)
  assert.match(code, /^\d{6}$/)
  assert.equal(code, shortCode(
    { ephemeralPublicKey: 'e', publicKey: 'p', displayName: 'A', deviceId: 'a', protocolVersion: 1 },
    right,
  ))
})

test('different hellos produce a different code', () => {
  const left = { protocolVersion: 1, deviceId: 'a', displayName: 'A', publicKey: 'p', ephemeralPublicKey: 'e' }
  const right = { protocolVersion: 1, deviceId: 'b', displayName: 'B', publicKey: 'q', ephemeralPublicKey: 'f' }
  const other = { ...right, ephemeralPublicKey: 'g' }
  assert.notEqual(shortCode(left, right), shortCode(left, other))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/short-code.test.js`
Expected: FAIL，找不到模块

- [ ] **Step 3: Write minimal implementation**

`package.json`:

```json
{
  "name": "dsh-link",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "engines": { "node": ">=22" },
  "exports": {
    ".": "./src/host-plugin.js",
    "./client": "./src/client.js"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-layout"
      ]
    }
  },
  "scripts": { "test": "node --test" },
  "dependencies": {
    "bonjour-service": "^1.3.0",
    "ws": "^8.18.3"
  }
}
```

`src/canonical-json.js`:

```js
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}
```

`src/short-code.js`:

```js
import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.js'

export function shortCode(initiatorHello, acceptorHello) {
  const material = `${canonicalJson(initiatorHello)}\n${canonicalJson(acceptorHello)}`
  const digest = createHash('sha256').update(material).digest()
  const number = (digest[0] << 16) | (digest[1] << 8) | digest[2]
  return String(number % 1_000_000).padStart(6, '0')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && node --test test/short-code.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/canonical-json.js src/short-code.js test/short-code.test.js
git commit -m "$(cat <<'EOF'
feat: add canonical JSON and the six-digit pairing code

EOF
)"
```

---

### Task 2: 短码失败锁定

**Files:**
- Create: `src/pairing-attempt.js`
- Test: `test/pairing-attempt.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `createPairingAttempt(): { isLocked(now: number): boolean, recordFailure(now: number): { locked: boolean }, recordSuccess(): void }`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPairingAttempt } from '../src/pairing-attempt.js'

test('the fifth failure locks for one minute and then allows a retry', () => {
  const attempt = createPairingAttempt()
  const start = 1_000_000
  for (let i = 0; i < 4; i += 1) assert.equal(attempt.recordFailure(start).locked, false)
  assert.equal(attempt.recordFailure(start).locked, true)
  assert.equal(attempt.isLocked(start + 59_999), true)
  assert.equal(attempt.isLocked(start + 60_000), false)
  assert.equal(attempt.recordFailure(start + 60_000).locked, false)
})

test('success clears the failure count', () => {
  const attempt = createPairingAttempt()
  attempt.recordFailure(0)
  attempt.recordFailure(0)
  attempt.recordSuccess()
  for (let i = 0; i < 4; i += 1) attempt.recordFailure(10)
  assert.equal(attempt.isLocked(10), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pairing-attempt.test.js`
Expected: FAIL，找不到 `createPairingAttempt`

- [ ] **Step 3: Write minimal implementation**

```js
export function createPairingAttempt() {
  let failures = 0
  let lockedUntil = 0
  return {
    isLocked(now) {
      return now < lockedUntil
    },
    recordFailure(now) {
      if (now >= lockedUntil) failures += 1
      if (failures >= 5) {
        failures = 0
        lockedUntil = now + 60_000
      }
      return { locked: now < lockedUntil }
    },
    recordSuccess() {
      failures = 0
      lockedUntil = 0
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pairing-attempt.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pairing-attempt.js test/pairing-attempt.test.js
git commit -m "$(cat <<'EOF'
feat: lock a pairing attempt after five bad codes

EOF
)"
```

---

### Task 3: 身份与已配对设备

**Files:**
- Create: `src/keys.js`
- Create: `src/identity-store.js`
- Create: `src/peer-store.js`
- Test: `test/stores.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `generateIdentity({ displayName, listenPort }): Identity`
  - `signNonce(privateKey: string, nonce: Buffer): string`
  - `verifyNonce(publicKey: string, nonce: Buffer, proof: string): boolean`
  - `createIdentityStore(dir: string): { load(): Promise<Identity|null>, save(identity: Identity): Promise<void> }`
  - `createPeerStore(dir: string): { list(): Promise<Peer[]>, get(deviceId: string): Promise<Peer|null>, put(peer: Peer): Promise<void>, remove(deviceId: string): Promise<void> }`
  - `Identity = { deviceId, displayName, publicKey, privateKey, listenPort, discoverable }`
  - `Peer = { deviceId, displayName, publicKey, lastHost, lastPort, enabled, pairedAt }`
  - 密钥字段是 SPKI / PKCS8 DER 的 base64

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateIdentity, signNonce, verifyNonce } from '../src/keys.js'
import { createIdentityStore } from '../src/identity-store.js'
import { createPeerStore } from '../src/peer-store.js'

test('a signed nonce verifies and a different nonce does not', () => {
  const identity = generateIdentity({ displayName: 'mac', listenPort: 48721 })
  const nonce = Buffer.from('0123456789abcdef0123456789abcdef')
  const proof = signNonce(identity.privateKey, nonce)
  assert.equal(verifyNonce(identity.publicKey, nonce, proof), true)
  assert.equal(verifyNonce(identity.publicKey, Buffer.from('z'.repeat(32)), proof), false)
})

test('identity and peers survive a new store on the same directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-link-'))
  try {
    const identities = createIdentityStore(dir)
    const identity = generateIdentity({ displayName: 'mac', listenPort: 48721 })
    await identities.save(identity)
    const peers = createPeerStore(dir)
    await peers.put({
      deviceId: 'peer-1',
      displayName: 'win',
      publicKey: 'cHVi',
      lastHost: '127.0.0.1',
      lastPort: 48722,
      enabled: true,
      pairedAt: 10,
    })
    const loaded = await createIdentityStore(dir).load()
    assert.equal(loaded.privateKey, identity.privateKey)
    assert.equal(loaded.discoverable, true)
    const again = await createPeerStore(dir).get('peer-1')
    assert.equal(again.displayName, 'win')
    await createPeerStore(dir).remove('peer-1')
    assert.equal(await createPeerStore(dir).get('peer-1'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/stores.test.js`
Expected: FAIL，找不到模块

- [ ] **Step 3: Write minimal implementation**

`src/keys.js`:

```js
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto'
import os from 'node:os'

export function generateIdentity({ displayName, listenPort }) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    deviceId: randomUUID(),
    displayName: displayName || os.hostname(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    listenPort,
    discoverable: true,
  }
}

function privateKey(value) {
  return createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })
}

function publicKey(value) {
  return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
}

export function signNonce(privateKeyValue, nonce) {
  return sign(null, nonce, privateKey(privateKeyValue)).toString('base64')
}

export function verifyNonce(publicKeyValue, nonce, proof) {
  return verify(null, nonce, publicKey(publicKeyValue), Buffer.from(proof, 'base64'))
}
```

`src/identity-store.js`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createIdentityStore(dir) {
  const file = path.join(dir, 'identity.json')
  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async save(identity) {
      await mkdir(dir, { recursive: true })
      await writeFile(file, JSON.stringify(identity))
    },
  }
}
```

`src/peer-store.js`:

```js
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

function peerPath(dir, deviceId) {
  return path.join(dir, 'peers', `${deviceId}.json`)
}

export function createPeerStore(dir) {
  const peersDir = path.join(dir, 'peers')
  return {
    async list() {
      try {
        const names = await readdir(peersDir)
        const peers = []
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          peers.push(JSON.parse(await readFile(path.join(peersDir, name), 'utf8')))
        }
        return peers
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    async get(deviceId) {
      try {
        return JSON.parse(await readFile(peerPath(dir, deviceId), 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async put(peer) {
      await mkdir(peersDir, { recursive: true })
      await writeFile(peerPath(dir, peer.deviceId), JSON.stringify(peer))
    },
    async remove(deviceId) {
      await rm(peerPath(dir, deviceId), { force: true })
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/stores.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/keys.js src/identity-store.js src/peer-store.js test/stores.test.js
git commit -m "$(cat <<'EOF'
feat: persist link identity and paired peers

EOF
)"
```

---

### Task 4: 帧、阶段白名单、事件分片

**Files:**
- Create: `src/frames.js`
- Test: `test/frames.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `encodeFrame(message: object): string`
  - `decodeFrame(text: string): object`
  - `assertPhase(phase: 'pairing'|'auth'|'open', type: string): void`
  - `splitEvent(delegationId: string, seq: number, event: object): object[]`
  - `createEventAssembler(): { push(part: object): { pending?: true, event?: object, error?: string } }`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPhase, createEventAssembler, decodeFrame, encodeFrame, splitEvent } from '../src/frames.js'

test('a frame over 1 MiB is rejected', () => {
  assert.throws(() => encodeFrame({ type: 'hello', blob: 'x'.repeat(1_048_577) }), /frame too large/)
})

test('delegate messages are refused before auth', () => {
  assert.throws(() => assertPhase('pairing', 'delegate.start'), /bad phase/)
  assert.doesNotThrow(() => assertPhase('open', 'delegate.start'))
  assert.doesNotThrow(() => assertPhase('pairing', 'hello'))
})

test('event parts reassemble in order and reject a body over 32 MiB', () => {
  const small = splitEvent('d1', 1, { type: 'tool/result', text: 'abc' })
  assert.equal(small.length, 1)
  const assembler = createEventAssembler()
  assert.equal(assembler.push(small[0]).event.text, 'abc')

  const huge = splitEvent('d2', 1, { text: 'y'.repeat(33_554_433) })
  const hugeAssembler = createEventAssembler()
  let result = { pending: true }
  for (const part of huge) result = hugeAssembler.push(part)
  assert.equal(result.error, '事件过大')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/frames.test.js`
Expected: FAIL，找不到 `src/frames.js`

- [ ] **Step 3: Write minimal implementation**

```js
export const MAX_FRAME_BYTES = 1_048_576
export const MAX_EVENT_BYTES = 33_554_432
const PART_BUDGET = 700_000

const allowed = {
  pairing: new Set(['hello', 'pair.confirm']),
  auth: new Set(['auth.challenge', 'auth.proof']),
  open: new Set([
    'delegate.start', 'delegate.started', 'delegate.ready', 'delegate.abort',
    'delegate.event', 'delegate.event.part', 'delegate.followup', 'delegate.cancel',
    'delegate.settled', 'resume',
  ]),
}

export function encodeFrame(message) {
  const text = JSON.stringify(message)
  if (Buffer.byteLength(text) > MAX_FRAME_BYTES) {
    throw new Error('frame too large')
  }
  return text
}

export function decodeFrame(text) {
  if (Buffer.byteLength(text) > MAX_FRAME_BYTES) throw new Error('frame too large')
  const message = JSON.parse(text)
  if (typeof message?.type !== 'string') throw new Error('bad frame')
  return message
}

export function assertPhase(phase, type) {
  if (!allowed[phase]?.has(type)) throw new Error(`bad phase ${phase} ${type}`)
}

export function splitEvent(delegationId, seq, event) {
  const body = JSON.stringify(event)
  if (Buffer.byteLength(body) <= PART_BUDGET) {
    return [{ type: 'delegate.event', delegationId, seq, event }]
  }
  const slices = []
  for (let index = 0; index < body.length; index += PART_BUDGET) slices.push(body.slice(index, index + PART_BUDGET))
  return slices.map((partBody, partIndex) => ({
    type: 'delegate.event.part',
    delegationId,
    seq,
    partIndex,
    partCount: slices.length,
    body: partBody,
  }))
}

export function createEventAssembler() {
  const pending = new Map()
  return {
    push(part) {
      if (part.type === 'delegate.event') return { event: part.event }
      const key = `${part.delegationId}:${part.seq}`
      const bucket = pending.get(key) ?? new Array(part.partCount)
      bucket[part.partIndex] = part.body
      if (bucket.some((item) => item === undefined)) {
        pending.set(key, bucket)
        return { pending: true }
      }
      pending.delete(key)
      const body = bucket.join('')
      if (Buffer.byteLength(body) > MAX_EVENT_BYTES) return { error: '事件过大' }
      return { event: JSON.parse(body) }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/frames.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/frames.js test/frames.test.js
git commit -m "$(cat <<'EOF'
feat: frame the link protocol and reassemble large events

EOF
)"
```

---

### Task 5: 握手

**Files:**
- Create: `src/handshake.js`
- Test: `test/handshake.test.js`

**Interfaces:**
- Consumes: `shortCode`、`createPairingAttempt`、`signNonce`、`verifyNonce`、`assertPhase`
- Produces: `createHandshake({ role, identity, knownPeer, attempt, now, send }): { start(): void, receive(message: object): void, submitCode(code: string): void, phase: string }`
  - `send` 收到的对象带 `type`
  - 结果通过 `handshake.outcome` 读取：`null`、`{ ok: true, peer }`、`{ ok: false, reason }`
  - `knownPeer` 为 `null` 时走短码；有值时跳过短码，只做鉴权，并在公钥不一致时返回 `密钥不符`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHandshake } from '../src/handshake.js'
import { generateIdentity } from '../src/keys.js'
import { createPairingAttempt } from '../src/pairing-attempt.js'

function pair(leftIdentity, rightIdentity, options = {}) {
  const pipes = { initiator: null, acceptor: null }
  const initiator = createHandshake({
    role: 'initiator',
    identity: leftIdentity,
    knownPeer: options.initiatorKnown ?? null,
    attempt: createPairingAttempt(),
    now: () => options.now ?? 0,
    send: (message) => pipes.acceptor.receive(message),
  })
  const acceptor = createHandshake({
    role: 'acceptor',
    identity: rightIdentity,
    knownPeer: options.acceptorKnown ?? null,
    attempt: options.acceptorAttempt ?? createPairingAttempt(),
    now: () => options.now ?? 0,
    send: (message) => pipes.initiator.receive(message),
  })
  pipes.initiator = initiator
  pipes.acceptor = acceptor
  return { initiator, acceptor }
}

test('matching codes save both peers and mismatched hellos save neither', () => {
  const left = generateIdentity({ displayName: 'mac', listenPort: 1 })
  const right = generateIdentity({ displayName: 'win', listenPort: 2 })
  const matched = pair(left, right)
  matched.initiator.start()
  assert.match(matched.initiator.code, /^\d{6}$/)
  matched.acceptor.submitCode(matched.initiator.code)
  assert.equal(matched.initiator.outcome.ok, true)
  assert.equal(matched.acceptor.outcome.ok, true)
  assert.equal(matched.initiator.outcome.peer.publicKey, right.publicKey)
  assert.equal(matched.acceptor.outcome.peer.publicKey, left.publicKey)
  assert.equal(matched.initiator.phase, 'open')

  const spoofed = pair(left, right)
  spoofed.initiator.start()
  spoofed.acceptor.submitCode('000000' === spoofed.initiator.code ? '000001' : '000000')
  assert.equal(spoofed.initiator.outcome, null)
  assert.equal(spoofed.acceptor.outcome.ok, false)
})

test('five bad codes lock the acceptor', () => {
  const left = generateIdentity({ displayName: 'mac', listenPort: 1 })
  const right = generateIdentity({ displayName: 'win', listenPort: 2 })
  const attempt = createPairingAttempt()
  for (let i = 0; i < 5; i += 1) {
    const session = pair(left, right, { acceptorAttempt: attempt, now: 100 })
    session.initiator.start()
    const wrong = session.initiator.code === '000000' ? '000001' : '000000'
    session.acceptor.submitCode(wrong)
  }
  assert.equal(attempt.isLocked(100), true)
  const locked = pair(left, right, { acceptorAttempt: attempt, now: 100 })
  locked.initiator.start()
  locked.acceptor.submitCode(locked.initiator.code)
  assert.equal(locked.acceptor.outcome.ok, false)
  assert.equal(locked.acceptor.outcome.reason, 'locked')
})

test('a known peer with a different key is rejected and the saved key is not replaced', () => {
  const left = generateIdentity({ displayName: 'mac', listenPort: 1 })
  const right = generateIdentity({ displayName: 'win', listenPort: 2 })
  const replacement = generateIdentity({ displayName: 'win', listenPort: 2 })
  const session = pair(left, replacement, {
    initiatorKnown: { deviceId: right.deviceId, publicKey: right.publicKey, displayName: 'win' },
    acceptorKnown: { deviceId: left.deviceId, publicKey: left.publicKey, displayName: 'mac' },
  })
  session.initiator.start()
  assert.equal(session.initiator.outcome.reason, '密钥不符')
})

test('protocol version 2 fails without saving a new peer', () => {
  const left = generateIdentity({ displayName: 'mac', listenPort: 1 })
  const right = generateIdentity({ displayName: 'win', listenPort: 2 })
  left.protocolVersion = 2
  const session = pair(left, right)
  session.initiator.start()
  assert.equal(session.acceptor.outcome.reason, '版本不一致')
  assert.equal(session.acceptor.outcome.saved, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/handshake.test.js`
Expected: FAIL，找不到 `createHandshake`

- [ ] **Step 3: Write minimal implementation**

```js
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { assertPhase } from './frames.js'
import { signNonce, verifyNonce } from './keys.js'
import { shortCode } from './short-code.js'

function helloBody(hello) {
  return {
    protocolVersion: hello.protocolVersion,
    deviceId: hello.deviceId,
    displayName: hello.displayName,
    publicKey: hello.publicKey,
    ephemeralPublicKey: hello.ephemeralPublicKey,
  }
}

export function createHandshake({ role, identity, knownPeer, attempt, now, send }) {
  const ephemeral = generateKeyPairSync('ed25519')
  const ephemeralPublicKey = ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  let phase = 'pairing'
  let localHello = null
  let remoteHello = null
  let code = null
  let outcome = null
  let provedPeer = false

  function sendHello() {
    localHello = {
      type: 'hello',
      protocolVersion: identity.protocolVersion ?? 1,
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      publicKey: identity.publicKey,
      ephemeralPublicKey,
    }
    send(localHello)
  }

  function refreshCode() {
    if (!localHello || !remoteHello) return
    const initiatorHello = role === 'initiator' ? localHello : remoteHello
    const acceptorHello = role === 'acceptor' ? localHello : remoteHello
    code = shortCode(helloBody(initiatorHello), helloBody(acceptorHello))
  }

  function finish() {
    phase = 'open'
    outcome = {
      ok: true,
      saved: true,
      peer: {
        deviceId: remoteHello.deviceId,
        displayName: remoteHello.displayName,
        publicKey: remoteHello.publicKey,
      },
    }
  }

  function sendChallenge() {
    send({ type: 'auth.challenge', nonce: randomBytes(32).toString('base64') })
  }

  return {
    get phase() { return phase },
    get code() { return code },
    get outcome() { return outcome },
    start() {
      if (role === 'initiator') sendHello()
    },
    submitCode(input) {
      if (role !== 'acceptor' || outcome) return
      if (attempt.isLocked(now())) {
        outcome = { ok: false, reason: 'locked', saved: false }
        return
      }
      if (input !== code) {
        attempt.recordFailure(now())
        outcome = { ok: false, reason: 'locked', saved: false }
        return
      }
      attempt.recordSuccess()
      send({ type: 'pair.confirm', code: input })
      phase = 'auth'
      sendChallenge()
    },
    receive(message) {
      if (outcome?.ok === false) return
      try { assertPhase(phase, message.type) } catch { return }
      if (message.type === 'hello') {
        if (message.protocolVersion !== 1) {
          outcome = { ok: false, reason: '版本不一致', saved: false }
          return
        }
        if (knownPeer && (message.deviceId !== knownPeer.deviceId || message.publicKey !== knownPeer.publicKey)) {
          outcome = { ok: false, reason: '密钥不符', saved: false }
          return
        }
        remoteHello = message
        if (role === 'acceptor' && !localHello) sendHello()
        refreshCode()
        if (knownPeer && localHello && remoteHello) {
          phase = 'auth'
          if (role === 'acceptor') sendChallenge()
        }
        return
      }
      if (message.type === 'pair.confirm') {
        if (message.code !== code) {
          outcome = { ok: false, reason: 'locked', saved: false }
          return
        }
        phase = 'auth'
        return
      }
      if (message.type === 'auth.challenge') {
        send({
          type: 'auth.proof',
          nonce: message.nonce,
          proof: signNonce(identity.privateKey, Buffer.from(message.nonce, 'base64')),
        })
        if (role === 'initiator') sendChallenge()
        if (role === 'acceptor' && provedPeer) finish()
        return
      }
      if (message.type === 'auth.proof') {
        const nonce = Buffer.from(message.nonce, 'base64')
        if (!verifyNonce(remoteHello.publicKey, nonce, message.proof)) {
          outcome = { ok: false, reason: '密钥不符', saved: false }
          return
        }
        provedPeer = true
        if (role === 'acceptor') return
        finish()
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/handshake.test.js`
Expected: PASS。若「不同 hello 不保存」那条里错误短码碰巧撞上真实短码，测试换一个与 `initiator.code` 不同的 6 位字符串。

- [ ] **Step 5: Commit**

```bash
git add src/handshake.js test/handshake.test.js
git commit -m "$(cat <<'EOF'
feat: pair with a short code and mutual signatures

EOF
)"
```

---

### Task 6: WebSocket 拨号与同时连接取舍

**Files:**
- Create: `src/wire.js`
- Test: `test/wire.test.js`

**Interfaces:**
- Consumes: `createHandshake`、`encodeFrame`、`decodeFrame`、`generateIdentity`、`createPairingAttempt`
- Produces: `listen(identity, onSocket): Promise<{ port: number, close(): Promise<void> }>`；`dial({ host, port, timeoutMs }): Promise<WebSocket>`；`chooseWinner({ localDeviceId, remoteDeviceId, localDialed: boolean }): 'local'|'remote'`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wire.test.js`
Expected: FAIL，找不到 `src/wire.js`

- [ ] **Step 3: Write minimal implementation**

```js
import { WebSocket, WebSocketServer } from 'ws'

export function chooseWinner({ localDeviceId, remoteDeviceId, localDialed }) {
  const dialerId = localDialed ? localDeviceId : remoteDeviceId
  const smaller = localDeviceId < remoteDeviceId ? localDeviceId : remoteDeviceId
  if (dialerId === smaller) return localDialed ? 'local' : 'remote'
  return localDialed ? 'remote' : 'local'
}

export function dial({ host, port, timeoutMs = 8_000 }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${host}:${port}`)
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('地址不可达'))
    }, timeoutMs)
    socket.once('open', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      reject(new Error('地址不可达'))
    })
  })
}

export function listen(identity, onSocket) {
  const server = new WebSocketServer({ port: identity.listenPort || 0 })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      server.on('connection', (socket) => onSocket(socket))
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
```

`chooseWinner` 保留字典序较小的 deviceId 拨出的那条连接。`localDialed: true` 表示本机拨出了正在判断的这条连接。返回 `local` 表示留下本机拨出的连接，返回 `remote` 表示留下对方拨出的连接。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/wire.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wire.js test/wire.test.js
git commit -m "$(cat <<'EOF'
feat: dial and listen on the link socket

EOF
)"
```

---

### Task 7: 开关与退避重拨

**Files:**
- Create: `src/supervisor.js`
- Test: `test/supervisor.test.js`

**Interfaces:**
- Consumes: `chooseWinner`、`dial` 的超时错误文本 `地址不可达`
- Produces: `createSupervisor({ peers, dial, now, schedule, cancel }): { setEnabled(deviceId, enabled): void, noteConnected(deviceId): void, noteDropped(deviceId): void, noteAddress(deviceId, host, port, connected: boolean): Promise<void>, stop(): void }`
  - `schedule(fn, ms)` 返回句柄，`cancel(handle)` 取消它
  - `dial(peer)` 返回 Promise

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createSupervisor } from '../src/supervisor.js'

test('an enabled peer redials at 1s, 2s, 4s, then 15s', () => {
  const waits = []
  const dials = []
  let clock = 0
  const timers = []
  const peers = [{ deviceId: 'b', enabled: true, lastHost: '10.0.0.2', lastPort: 9 }]
  const supervisor = createSupervisor({
    peers,
    dial: (peer) => { dials.push(clock); return Promise.reject(new Error('地址不可达')) },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/supervisor.test.js`
Expected: FAIL，找不到 `createSupervisor`

- [ ] **Step 3: Write minimal implementation**

```js
const BACKOFF = [1000, 2000, 4000, 15000]

export function createSupervisor({ peers, dial, schedule, cancel }) {
  const timers = new Map()
  const attempts = new Map()
  function peer(deviceId) {
    return peers.find((item) => item.deviceId === deviceId)
  }
  function clear(deviceId) {
    const handle = timers.get(deviceId)
    if (handle) cancel(handle)
    timers.delete(deviceId)
  }
  function arm(deviceId) {
    const current = peer(deviceId)
    if (!current?.enabled) return
    clear(deviceId)
    const step = Math.min(attempts.get(deviceId) ?? 0, BACKOFF.length - 1)
    const handle = schedule(() => {
      attempts.set(deviceId, step + 1)
      dial(current).then(() => attempts.set(deviceId, 0)).catch(() => arm(deviceId))
    }, BACKOFF[step])
    timers.set(deviceId, handle)
  }
  return {
    setEnabled(deviceId, enabled) {
      const current = peer(deviceId)
      current.enabled = enabled
      if (!enabled) {
        clear(deviceId)
        attempts.set(deviceId, 0)
        return
      }
      arm(deviceId)
    },
    noteConnected(deviceId) {
      attempts.set(deviceId, 0)
      clear(deviceId)
    },
    noteDropped(deviceId) {
      arm(deviceId)
    },
    async noteAddress(deviceId, host, port, connected) {
      const current = peer(deviceId)
      current.lastHost = host
      current.lastPort = port
      if (!connected && current.enabled) await dial(current)
    },
    stop() {
      for (const deviceId of timers.keys()) clear(deviceId)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/supervisor.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/supervisor.js test/supervisor.test.js
git commit -m "$(cat <<'EOF'
feat: redial enabled peers with capped backoff

EOF
)"
```

---

### Task 8: mDNS

**Files:**
- Create: `src/mdns.js`
- Test: `test/mdns.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `createMdns({ publish, unpublish, browse, stopBrowse }): { start(identity): void, stop(): void, onNearby(fn): void }`
  - `publish({ name, type, port, txt })`
  - `browse({ type }, fn)` 的 `fn` 收到 `{ host, port, txt }`
  - TXT 含 `deviceId`、`displayName`、`ver: '1'`
  - `type` 是 `dsh-link`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMdns } from '../src/mdns.js'

test('publishing is skipped when the device is not discoverable', () => {
  const calls = []
  const mdns = createMdns({
    publish: (service) => calls.push(service),
    unpublish: () => {},
    browse: () => {},
    stopBrowse: () => {},
  })
  mdns.start({ deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: false })
  assert.equal(calls.length, 0)
})

test('a discovered service becomes a nearby device', () => {
  let found = null
  let browser = null
  const mdns = createMdns({
    publish: () => {},
    unpublish: () => {},
    browse: (_query, onService) => { browser = onService },
    stopBrowse: () => {},
  })
  mdns.onNearby((device) => { found = device })
  mdns.start({ deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: true })
  browser({ host: '10.0.0.8', port: 48721, txt: { deviceId: 'peer', displayName: 'win', ver: '1' } })
  assert.deepEqual(found, { deviceId: 'peer', displayName: 'win', host: '10.0.0.8', port: 48721 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mdns.test.js`
Expected: FAIL，找不到 `createMdns`

- [ ] **Step 3: Write minimal implementation**

```js
export function createMdns({ publish, unpublish, browse, stopBrowse }) {
  let published = null
  let listening = false
  const handlers = new Set()
  return {
    start(identity) {
      if (!listening) {
        browse({ type: 'dsh-link' }, (service) => {
          if (service.txt?.ver !== '1' || !service.txt.deviceId) return
          const device = {
            deviceId: service.txt.deviceId,
            displayName: service.txt.displayName,
            host: service.host,
            port: service.port,
          }
          for (const handler of handlers) handler(device)
        })
        listening = true
      }
      if (!identity.discoverable) {
        if (published) unpublish(published)
        published = null
        return
      }
      published = publish({
        name: identity.deviceId,
        type: 'dsh-link',
        port: identity.listenPort,
        txt: { deviceId: identity.deviceId, displayName: identity.displayName, ver: '1' },
      })
    },
    stop() {
      if (published) unpublish(published)
      published = null
      if (listening) stopBrowse()
      listening = false
    },
    onNearby(handler) {
      handlers.add(handler)
    },
  }
}

export async function createBonjourMdns() {
  const { Bonjour } = await import('bonjour-service')
  const bonjour = new Bonjour()
  let browser = null
  return createMdns({
    publish: (service) => bonjour.publish(service),
    unpublish: (service) => service.stop(),
    browse: (query, onService) => {
      browser = bonjour.find(query, onService)
    },
    stopBrowse: () => browser?.stop(),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mdns.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mdns.js test/mdns.test.js
git commit -m "$(cat <<'EOF'
feat: advertise and browse link devices on the LAN

EOF
)"
```

---

### Task 9: 连接服务

**Files:**
- Create: `src/link-service.js`
- Test: `test/link-service.test.js`

**Interfaces:**
- Consumes: Task 3 到 Task 8 的导出
- Produces: `startLinkService({ home, listenPort, dialImpl, listenImpl, mdns }): Promise<{ snapshot(): object, pair(host: string, port: number): Promise<void>, submitCode(deviceId: string, code: string): Promise<void>, setEnabled(deviceId: string, enabled: boolean): Promise<void>, unpair(deviceId: string): Promise<void>, setDiscoverable(value: boolean): Promise<void>, setDisplayName(name: string): Promise<void>, stop(): Promise<void> }>`
  - `snapshot().local` 含 `deviceId`、`displayName`、`shortId`（前 8 位）、`port`、`discoverable`
  - `snapshot().peers[]` 含 `status`：`disabled`、`connecting`、`connected`、`reconnecting`、`failed`
  - `snapshot().pending[]` 在发起方一侧含 `code`
  - 服务不提供委托方法。鉴权后收到 `delegate.*` 或 `resume` 时丢弃

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startLinkService } from '../src/link-service.js'

async function tempHome() {
  return mkdtemp(path.join(tmpdir(), 'dsh-link-home-'))
}

test('two services pair, restart, and reconnect from the switch without a new code', async () => {
  const leftHome = await tempHome()
  const rightHome = await tempHome()
  const left = await startLinkService({ home: leftHome, listenPort: 0 })
  const right = await startLinkService({ home: rightHome, listenPort: 0 })
  try {
    await left.pair('127.0.0.1', left.snapshot().local.port === right.snapshot().local.port
      ? right.snapshot().local.port
      : right.snapshot().local.port)
    const pending = left.snapshot().pending[0]
    assert.match(pending.code, /^\d{6}$/)
    await right.submitCode(pending.deviceId, pending.code)
    assert.equal(left.snapshot().peers[0].status, 'connected')
    const peerId = left.snapshot().peers[0].deviceId
    await left.stop()
    await right.stop()
    const leftAgain = await startLinkService({ home: leftHome, listenPort: 0 })
    const rightAgain = await startLinkService({ home: rightHome, listenPort: 0 })
    try {
      await leftAgain.setEnabled(peerId, true)
      await new Promise((resolve) => setTimeout(resolve, 300))
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
    const pending = left.snapshot().pending[0]
    const wrong = pending.code === '000000' ? '000001' : '000000'
    await right.submitCode(pending.deviceId, wrong)
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
    const pending = left.snapshot().pending[0]
    await right.submitCode(pending.deviceId, pending.code)
    const peerId = left.snapshot().peers[0].deviceId
    await left.setEnabled(peerId, false)
    assert.equal(left.snapshot().peers[0].status, 'disabled')
    await left.setEnabled(peerId, true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(left.snapshot().peers[0].status, 'connected')
  } finally {
    await left.stop()
    await right.stop()
    await rm(leftHome, { recursive: true, force: true })
    await rm(rightHome, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/link-service.test.js`
Expected: FAIL，找不到 `startLinkService`

- [ ] **Step 3: Write minimal implementation**

`startLinkService` 按这个顺序接起来：

1. `home` 下面用 `createIdentityStore`。没有身份就 `generateIdentity({ listenPort: listenPort || 48721 })` 并保存。
2. `listen(identity, onSocket)`。调用方传入 `listenPort: 0` 且身份文件里已有端口时，绑定那个已保存的端口。只有第一次没有端口，或该端口 `EADDRINUSE` 时，才改绑端口 `0`。实际端口写回身份。这样重启后对端保存的 `lastPort` 仍然有效。
3. 入站连接 `localDialed: false`。`pair()` 用 `dial` 拨出，`localDialed: true`。
4. 同一 `deviceId` 已有连接时用 `chooseWinner`。负方 `socket.close()`。
5. 新设备走 `knownPeer: null` 的握手。`snapshot().pending` 保存 `{ deviceId, role, code, host, port }`，发起方才填 `code`。
6. `submitCode` 把短码交给对应接受方握手。成功后 `peer-store.put`，`enabled: true`，`pairedAt: Date.now()`，`lastHost` / `lastPort` 来自这次套接字。状态 `connected`。
7. 重启后 `setEnabled(id, true)` 对已保存对端拨 `lastHost` / `lastPort`，握手用 `knownPeer`，不再产生 `pending.code`。拨号前把状态设为 `connecting`；已连接过又掉线时设为 `reconnecting`。
8. `setEnabled(id, false)` 关闭套接字，状态 `disabled`，并让 supervisor 取消重拨。
9. 掉线且 `enabled` 仍为真时交给 supervisor。失败原因只写成 `地址不可达`。
10. `unpair` 删掉 peer 文件并关闭套接字。
11. 鉴权完成后，`delegate.*` 与 `resume` 解码成功后直接返回，不写文件、不发回复。
12. `createBonjourMdns()` 在测试里会占用局域网。`startLinkService` 默认使用一个不发布的 mdns 假对象；生产入口 `src/host-plugin.js` 再传入 `createBonjourMdns()`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/link-service.test.js`
Expected: PASS。300 毫秒不够时只把等待改成轮询 `snapshot()`，最多 2 秒，不要把超时放宽到 8 秒以上。

- [ ] **Step 5: Commit**

```bash
git add src/link-service.js test/link-service.test.js
git commit -m "$(cat <<'EOF'
feat: pair two link services and reconnect from the switch

EOF
)"
```

---

### Task 10: DSH 选项卡

**Files:**
- Create: `src/host-plugin.js`
- Create: `src/client.js`
- Test: `test/panel-model.test.js`
- Create: `src/panel-model.js`

**Interfaces:**
- Consumes: `startLinkService`
- Produces:
  - `panelModel(snapshot): { title: '设备', sections: ['local','peers','nearby','manual'] }`
  - Cordis 插件 `{ name: 'dsh-link', inject: ['webServer'], apply(ctx) }`
  - 浏览器插件注册 `sidebar.panellist` id `devices` 和 `main` key `devices`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { panelModel } from '../src/panel-model.js'

test('the device panel has four sections and a short local id', () => {
  const model = panelModel({
    local: { deviceId: '123456789abc', displayName: 'mac', port: 48721, discoverable: true },
    peers: [{ deviceId: 'p', displayName: 'win', status: 'failed', failure: '密钥不符', lastHost: '10.0.0.2', lastPort: 48721, enabled: true }],
    nearby: [{ deviceId: 'n', displayName: 'linux', host: '10.0.0.3', port: 48721 }],
    pending: [],
  })
  assert.equal(model.title, '设备')
  assert.deepEqual(model.sections.map((section) => section.id), ['local', 'peers', 'nearby', 'manual'])
  assert.equal(model.sections[0].shortId, '12345678')
  assert.equal(model.sections[1].rows[0].failure, '密钥不符')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/panel-model.test.js`
Expected: FAIL，找不到 `panelModel`

- [ ] **Step 3: Write minimal implementation**

`src/panel-model.js`:

```js
export function panelModel(snapshot) {
  return {
    title: '设备',
    sections: [
      {
        id: 'local',
        displayName: snapshot.local.displayName,
        shortId: snapshot.local.deviceId.slice(0, 8),
        port: snapshot.local.port,
        discoverable: snapshot.local.discoverable,
      },
      { id: 'peers', rows: snapshot.peers },
      { id: 'nearby', rows: snapshot.nearby },
      { id: 'manual' },
    ],
  }
}
```

`src/host-plugin.js` 导出 `name = 'dsh-link'`、`inject = ['webServer']`、`apply(ctx)`。`apply` 调用 `startLinkService({ home: process.env.DSH_LINK_HOME, mdns: await createBonjourMdns() })`，并用 `ctx.webServer.register` 注册这些 exact 路由，路径都不在 `/api` 下：

| 方法与路径 | 行为 |
|---|---|
| `GET /dsh-link/state` | 返回 `snapshot()` JSON |
| `POST /dsh-link/pair` | 正文 `{ host, port }`，调用 `pair` |
| `POST /dsh-link/code` | 正文 `{ deviceId, code }`，调用 `submitCode` |
| `POST /dsh-link/switch` | 正文 `{ deviceId, enabled }` |
| `POST /dsh-link/unpair` | 正文 `{ deviceId }` |
| `POST /dsh-link/discoverable` | 正文 `{ value }` |
| `POST /dsh-link/display-name` | 正文 `{ name }` |

路由处理器读完请求正文再调用服务。响应 `200`，正文是最新 `snapshot()`。服务抛出的失败原因原样作为 `{ error }`，HTTP 状态 `400`。`ctx.effect` 在卸载时 `stop()`。

`src/client.js` 写成 DSH 浏览器工厂，而不是 ESM export：

```js
window.__ModuleLoader__.load({
  id: 'dsh-link',
  factory: (require) => {
    const jsx = require('react/jsx-runtime').jsx
    const React = require('react')
    const inject = ['slots', 'layout', 'locale']
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register('dsh-link', {
        zh: { 'panel.title': '设备' },
        en: { 'panel.title': 'Devices' },
      }))
      const t = ctx.locale.bind('dsh-link')
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'devices',
        order: 30,
        label: () => t('panel.title'),
        locale: 'dsh-link',
      }, function DevicesIcon() {
        return jsx('span', { children: '⧉' })
      }))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'devices',
        locale: 'dsh-link',
      }, function DevicesPanel() {
        const [state, setState] = React.useState(null)
        React.useEffect(() => {
          let stopped = false
          async function pull() {
            const response = await fetch('/dsh-link/state')
            if (!stopped) setState(await response.json())
          }
          pull()
          const timer = setInterval(pull, 1000)
          return () => { stopped = true; clearInterval(timer) }
        }, [])
        if (!state) return jsx('p', { children: '设备' })
        return jsx('div', { children: '设备' })
      }))
    }
    return { apply, inject }
  },
})
```

把 `DevicesPanel` 补成四块，文案用这些词：本机、已记住的设备、附近尚未配对的设备、手动地址、连接并配对、取消配对、允许被局域网发现。发起方 `pending.code` 用大字显示。接受方对 `pending` 且没有 `code` 的设备显示一个 6 位输入框，提交到 `POST /dsh-link/code`。开关提交 `POST /dsh-link/switch`。不要在这个文件里发 `delegate.start`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/panel-model.test.js && node --test`
Expected: PASS，全部既有测试仍通过

- [ ] **Step 5: Commit**

```bash
git add src/panel-model.js src/host-plugin.js src/client.js test/panel-model.test.js
git commit -m "$(cat <<'EOF'
feat: add the device tab for pairing and connection switches

EOF
)"
```

---

### Task 11: 两个进程与 DSH 手测

**Files:**
- Create: `test/two-process.test.js`
- Create: `scripts/link-process.js`

**Interfaces:**
- Consumes: `startLinkService`
- Produces: 一个可由 `node scripts/link-process.js` 启动的进程。环境变量 `DSH_LINK_HOME` 与 `DSH_LINK_PORT`。标准输出一行 JSON：`{ port }`

- [ ] **Step 1: Write the failing test**

```js
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
  await fetch(`http://127.0.0.1:${rightReady.uiPort}/dsh-link/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: leftState.pending[0].deviceId, code }),
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
  await new Promise((resolve) => setTimeout(resolve, 500))
  const after = await (await fetch(`http://127.0.0.1:${leftReady.uiPort}/dsh-link/state`)).json()
  assert.equal(after.peers[0].status, 'connected')
  assert.ok(rightReadyAgain.port > 0)
  leftAgain.child.kill()
  rightAgain.child.kill()
  await rm(leftHome, { recursive: true, force: true })
  await rm(rightHome, { recursive: true, force: true })
})
```

`scripts/link-process.js` 除了链路端口，还要在 `127.0.0.1` 上另听一个只绑本机的 HTTP 端口，提供 Task 10 的同一组 `/dsh-link/*` 路由。启动行打印 `{ "port": <链路端口>, "uiPort": <本机 HTTP 端口> }`。DSH 里的选项卡仍走 `ctx.webServer`，不走这个额外端口。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/two-process.test.js`
Expected: FAIL，找不到 `scripts/link-process.js`

- [ ] **Step 3: Write minimal implementation**

实现 `scripts/link-process.js`：读 `DSH_LINK_HOME` 与 `DSH_LINK_PORT`，启动 `startLinkService`，再用 `node:http` 把 Task 10 的七个路径挂到 `127.0.0.1:0`。打印一行 JSON 后保持进程。`SIGTERM` 时 `stop()` 并退出 0。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS

然后在本机 DSH 上做第 1 段手测，命令写在完成记录里：

```bash
cd ~/.dsh/profiles/web
pnpm add /Users/yiwen/Projects/dsh-link
```

在 `~/.dsh/profiles/web/cordis.patch.yml` 的数组里加入：

```yaml
- id: dsh-link
  name: dsh-link
```

用两个不同的 `DSH_HOME` 启动两个 DSH。两个「设备」选项卡里，用手动地址配对，确认短码一致后两边出现已连接设备。停掉两边再启动，打开开关后恢复连接，不再出现短码。输入错误短码时已配对列表不增加。关掉开关后状态变为已配对但关闭，再打开能连上。

- [ ] **Step 5: Commit**

```bash
git add scripts/link-process.js test/two-process.test.js
git commit -m "$(cat <<'EOF'
test: pair two link processes and reconnect after restart

EOF
)"
```
