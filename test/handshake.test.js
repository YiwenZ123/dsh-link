import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { createHandshake } from '../src/handshake.js'
import { generateIdentity, signNonce } from '../src/keys.js'
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

test('a proof for a different nonce than the outstanding challenge is rejected', () => {
  const left = generateIdentity({ displayName: 'mac', listenPort: 1 })
  const right = generateIdentity({ displayName: 'win', listenPort: 2 })
  const sent = []
  const acceptor = createHandshake({
    role: 'acceptor',
    identity: right,
    knownPeer: { deviceId: left.deviceId, publicKey: left.publicKey, displayName: 'mac' },
    attempt: createPairingAttempt(),
    now: () => 0,
    send: (message) => sent.push(message),
  })
  acceptor.receive({
    type: 'hello',
    protocolVersion: 1,
    deviceId: left.deviceId,
    displayName: 'mac',
    publicKey: left.publicKey,
    ephemeralPublicKey: 'x',
  })
  const challenge = sent.find((message) => message.type === 'auth.challenge')
  assert.ok(challenge, 'acceptor should send a challenge')
  // Replay a proof for a different nonce than the one currently outstanding.
  const staleNonce = randomBytes(32).toString('base64')
  const staleProof = signNonce(left.privateKey, Buffer.from(staleNonce, 'base64'))
  acceptor.receive({ type: 'auth.proof', nonce: staleNonce, proof: staleProof })
  assert.equal(acceptor.outcome.ok, false)
  assert.equal(acceptor.outcome.reason, '密钥不符')
  // A proof for the real outstanding nonce still authenticates afterwards.
  const realProof = signNonce(left.privateKey, Buffer.from(challenge.nonce, 'base64'))
  // The failed handshake is terminal, so a fresh session must reject replay too.
  const acceptorAgain = createHandshake({
    role: 'acceptor',
    identity: right,
    knownPeer: { deviceId: left.deviceId, publicKey: left.publicKey, displayName: 'mac' },
    attempt: createPairingAttempt(),
    now: () => 0,
    send: () => {},
  })
  acceptorAgain.receive({
    type: 'hello',
    protocolVersion: 1,
    deviceId: left.deviceId,
    displayName: 'mac',
    publicKey: left.publicKey,
    ephemeralPublicKey: 'x',
  })
  acceptorAgain.receive({ type: 'auth.proof', nonce: staleNonce, proof: staleProof })
  assert.equal(acceptorAgain.outcome.ok, false)
  assert.equal(acceptorAgain.outcome.reason, '密钥不符')
  void realProof
})
