import assert from 'node:assert/strict'
import test from 'node:test'
import { panelModel } from '../src/panel-model.js'

test('the device panel has four sections and a short local id', () => {
  const model = panelModel({
    local: { deviceId: '123456789abc', displayName: 'mac', port: 48721, discoverable: true },
    peers: [{ deviceId: 'p', displayName: 'win', status: 'failed', failure: '密钥不符', lastHost: '10.0.0.2', lastPort: 48721, enabled: true }],
    nearby: [{ deviceId: 'n', displayName: 'linux', host: '10.0.0.3', port: 48721 }],
    pending: [],
  })
  assert.equal(model.title, '设备')
  assert.deepEqual(model.sections.map((section) => section.id), ['local', 'peers', 'nearby', 'manual'])
  assert.equal(model.sections[0].shortId, '12345678')
  assert.equal(model.sections[1].rows[0].failure, '密钥不符')
})
