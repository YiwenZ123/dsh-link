import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.js'

export function shortCode(initiatorHello, acceptorHello) {
  const material = `${canonicalJson(initiatorHello)}\n${canonicalJson(acceptorHello)}`
  const digest = createHash('sha256').update(material).digest()
  const number = (digest[0] << 16) | (digest[1] << 8) | digest[2]
  return String(number % 1_000_000).padStart(6, '0')
}
