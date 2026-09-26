import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
    const peerId = '11111111-2222-4333-8444-555555555555'
    await peers.put({
      deviceId: peerId,
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
    const again = await createPeerStore(dir).get(peerId)
    assert.equal(again.displayName, 'win')
    await createPeerStore(dir).remove(peerId)
    assert.equal(await createPeerStore(dir).get(peerId), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a UTF-8 BOM prepended by a Windows editor does not break the stores', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-link-'))
  try {
    const identity = generateIdentity({ displayName: 'win', listenPort: 48721 })
    const peerId = '11111111-2222-4333-8444-555555555555'
    await mkdir(path.join(dir, 'peers'), { recursive: true })
    await writeFile(path.join(dir, 'identity.json'), `\uFEFF${JSON.stringify(identity)}`)
    await writeFile(
      path.join(dir, 'peers', `${peerId}.json`),
      `\uFEFF${JSON.stringify({ deviceId: peerId, displayName: 'mac', publicKey: 'cHVi' })}`,
    )
    const loaded = await createIdentityStore(dir).load()
    assert.equal(loaded.privateKey, identity.privateKey)
    assert.equal(loaded.listenPort, 48721)
    assert.equal((await createPeerStore(dir).get(peerId)).displayName, 'mac')
    assert.equal((await createPeerStore(dir).list()).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a deviceId containing .. or a slash is rejected by the peer store', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-link-'))
  try {
    const peers = createPeerStore(dir)
    for (const bad of ['..', 'a..b', 'a/b', 'a\\b', 'peer-1', 'not-a-uuid']) {
      await assert.rejects(peers.put({ deviceId: bad, displayName: 'x', publicKey: 'k' }), /invalid deviceId/)
    }
    await assert.rejects(peers.get('..'), /invalid deviceId/)
    await assert.rejects(peers.remove('a/b'), /invalid deviceId/)
    const names = await readdir(path.join(dir, 'peers')).catch(() => [])
    assert.equal(names.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
