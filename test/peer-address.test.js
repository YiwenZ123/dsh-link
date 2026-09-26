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

test('a discovery without an IPv4 keeps the advertised host', () => {
  const found = browseOne({
    host: 'YiwendeMacBook-Air-152.local',
    port: 64955,
    addresses: ['fe80::1c44:a275:21aa:fe70'],
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.equal(found[0].host, 'YiwendeMacBook-Air-152.local')
})

test('a discovery with no address list at all still reports the host', () => {
  const found = browseOne({
    host: 'mac.local',
    port: 64955,
    txt: { deviceId: 'peer', displayName: 'mac', ver: '1' },
  })
  assert.equal(found[0].host, 'mac.local')
})
