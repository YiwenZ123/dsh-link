import assert from 'node:assert/strict'
import test from 'node:test'
import { createMdns } from '../src/mdns.js'

test('publishing is skipped when the device is not discoverable', () => {
  const calls = []
  const mdns = createMdns({
    publish: (service) => calls.push(service),
    unpublish: () => {},
    browse: () => {},
    stopBrowse: () => {},
  })
  mdns.start({ deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: false })
  assert.equal(calls.length, 0)
})

test('a discovered service becomes a nearby device', () => {
  let found = null
  let browser = null
  const mdns = createMdns({
    publish: () => {},
    unpublish: () => {},
    browse: (_query, onService) => { browser = onService },
    stopBrowse: () => {},
  })
  mdns.onNearby((device) => { found = device })
  mdns.start({ deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: true })
  browser({ host: '10.0.0.8', port: 48721, txt: { deviceId: 'peer', displayName: 'win', ver: '1' } })
  assert.deepEqual(found, { deviceId: 'peer', displayName: 'win', host: '10.0.0.8', port: 48721 })
})
