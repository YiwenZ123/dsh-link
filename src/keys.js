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
