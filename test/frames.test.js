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
