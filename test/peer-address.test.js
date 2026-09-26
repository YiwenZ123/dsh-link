// A discovered address must be an address a dial can actually use: a host
// name that only resolves through multicast DNS is what a poisoned resolver
// turns into a dead target, while the browse result already carries the
// peer's literal IPv4.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMdns } from '../src/mdns.js'

function browseOne(service) {
  let emit = null
  const mdns = createMdns({
    publish: (entry) => entry,
    unpublish: () => {},
    browse: (_query, onService) => { emit = onService },
    stopBrowse: () => {},
  })
  const found = []
  mdns.onNearby((device) => found.push(device))
  mdns.start({ deviceId: 'self', displayName: 'self', listenPort: 48721, discoverable: true })
  emit(service)
  return found
}

test('a discovery prefers the advertised IPv4 over the host name', () => {
  const found = browseOne({
    host: 'YiwendeMacBook-Air-152.local',
    port: 64955,
    addresses: ['fe80::1c44:a275:21aa:fe70', '192.168.3.118'],
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].host, '192.168.3.118')
  assert.equal(found[0].port, 64955)
})

test('a name-only advertisement is reported as nothing at all', () => {
  // Keeping the host name here is the trap this file exists for: the name is
  // dialable only through multicast DNS, a proxy on the far machine answers it
  // with a fake IP, and the resulting record points at an address that never
  // answers while looking healthy. Reporting no candidate leaves the user the
  // manual address, which is honest.
  const found = browseOne({
    host: 'YiwendeMacBook-Air-152.local',
    port: 64955,
    addresses: ['fe80::1c44:a275:21aa:fe70'],
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.deepEqual(found, [])
})

test('a discovery with no address list at all is reported as nothing', () => {
  const found = browseOne({
    host: 'mac.local',
    port: 64955,
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.deepEqual(found, [])
})

test('a fake-IP address is rejected like a name', () => {
  // Clash and its forks answer unresolvable names inside 198.18.0.0/15, the
  // range RFC 2544 reserves. The measured Mac name resolved to 198.18.0.56 on
  // the Windows side while 192.168.3.118 answered, so a browse result must not
  // hand this address on.
  const found = browseOne({
    host: 'YiwendeMacBook-Air-152.local',
    port: 64955,
    addresses: ['198.18.0.56', 'fe80::1c44:a275:21aa:fe70'],
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.deepEqual(found, [])
})

test('a usable IPv4 wins over a fake one regardless of order', () => {
  const found = browseOne({
    host: 'mac.local',
    port: 64955,
    addresses: ['198.18.0.56', '192.168.3.118'],
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].host, '192.168.3.118')
})

test('a fake-IP literal is rejected as a dialable address', async () => {
  // The host half keeps whatever address the connection was reached on. If a
  // poisoned resolution ever produces a fake IP, storing it turns every later
  // redial into a connection to an address that never answers, so the
  // predicate refuses the range outright.
  const { startLinkService } = await import('../src/link-service.js')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = (await import('node:path')).default
  const home = await mkdtemp(path.join(tmpdir(), 'peer-address-'))
  const service = await startLinkService({ home, listenPort: 0 })
  try {
    assert.equal(service.__literalAddress('192.168.3.118'), true)
    assert.equal(service.__literalAddress('198.18.0.56'), false)
    assert.equal(service.__literalAddress('YiwendeMacBook-Air-152.local'), false)
    assert.equal(service.__literalAddress(undefined), false)
    assert.equal(service.__literalAddress(''), false)
  } finally {
    await service.stop()
    await rm(home, { recursive: true, force: true })
  }
})
