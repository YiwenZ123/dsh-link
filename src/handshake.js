import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { assertPhase } from './frames.js'
import { signNonce, verifyNonce } from './keys.js'
import { shortCode } from './short-code.js'

// The signed/subject body of a hello: unchanged since protocol version 1, and
// deliberately NOT extended with `listenPort`. The six-digit code hashes this
// body, so adding a field here would make a v1 peer derive a different code
// from the same wire hello and the two sides would never agree. `listenPort`
// travels as an extra hello field instead — it is read from an already
// authenticated connection, which is enough for an address hint.
function helloBody(hello) {
  return {
    protocolVersion: hello.protocolVersion,
    deviceId: hello.deviceId,
    displayName: hello.displayName,
    publicKey: hello.publicKey,
    ephemeralPublicKey: hello.ephemeralPublicKey,
  }
}

/** A usable TCP port hint, or undefined for anything else (including absence). */
function advertisedPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined
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
  let expectedNonce = null

  function sendHello() {
    localHello = {
      type: 'hello',
      protocolVersion: identity.protocolVersion ?? 1,
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      publicKey: identity.publicKey,
      ephemeralPublicKey,
      listenPort: identity.listenPort,
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
        // Absent from a protocol-version-1 hello that predates this field;
        // callers fall back to the socket's peer port.
        listenPort: advertisedPort(remoteHello.listenPort),
      },
    }
  }

  function sendChallenge() {
    const nonce = randomBytes(32).toString('base64')
    expectedNonce = nonce
    send({ type: 'auth.challenge', nonce })
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
        if (!expectedNonce || message.nonce !== expectedNonce) {
          outcome = { ok: false, reason: '密钥不符', saved: false }
          expectedNonce = null
          return
        }
        const nonce = Buffer.from(message.nonce, 'base64')
        if (!verifyNonce(remoteHello.publicKey, nonce, message.proof)) {
          expectedNonce = null
          outcome = { ok: false, reason: '密钥不符', saved: false }
          return
        }
        expectedNonce = null
        provedPeer = true
        if (role === 'acceptor') return
        finish()
      }
    },
  }
}
