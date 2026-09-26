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
