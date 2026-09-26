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
