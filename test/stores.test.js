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
