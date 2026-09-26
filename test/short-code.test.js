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
