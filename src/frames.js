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
      const bucket = pending.get(key) ?? Array.from({ length: part.partCount })
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
