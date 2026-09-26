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

test('the machine\'s own advertisement is not offered as a nearby device', () => {
  const found = []
  let browser = null
  const mdns = createMdns({
    publish: () => {},
    unpublish: () => {},
    browse: (_query, onService) => { browser = onService },
    stopBrowse: () => {},
  })
  mdns.onNearby((device) => found.push(device))
  const identity = { deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: true }
  mdns.start(identity)
  browser({ host: '10.0.0.9', port: 48721, txt: { deviceId: 'abc', displayName: 'mac', ver: '1' } })
  browser({ host: '10.0.0.8', port: 48721, txt: { deviceId: 'peer', displayName: 'win', ver: '1' } })
  assert.deepEqual(found.map((device) => device.deviceId), ['peer'])
})

test('a refused advertisement does not fail start, and the name stays readable', () => {
  const published = []
  const mdns = createMdns({
    publish: (service) => {
      published.push(service)
      if (published.length === 1) throw new Error('Service name is already in use on the network')
      return service
    },
    unpublish: () => {},
    browse: () => {},
    stopBrowse: () => {},
  })
  const identity = { deviceId: 'abcdefgh-1234', displayName: 'mac', listenPort: 48721, discoverable: true }
  assert.doesNotThrow(() => mdns.start(identity))
  assert.equal(published[0].name, 'mac (abcdefgh)')
  assert.equal(published[0].txt.deviceId, identity.deviceId)
  mdns.start(identity)
  assert.equal(published.length, 2)
})

test('a non-discoverable restart unpublishes the advertisement', () => {
  const stopped = []
  const mdns = createMdns({
    publish: () => ({ stop: () => stopped.push('stopped') }),
    unpublish: (service) => service.stop(),
    browse: () => {},
    stopBrowse: () => {},
  })
  mdns.start({ deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: true })
  mdns.start({ deviceId: 'abc', displayName: 'mac', listenPort: 48721, discoverable: false })
  assert.equal(stopped.length, 1)
})
