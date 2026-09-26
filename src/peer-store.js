import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertUuidDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) {
    throw new Error('invalid deviceId')
  }
}

function peerPath(dir, deviceId) {
  assertUuidDeviceId(deviceId)
  return path.join(dir, 'peers', `${deviceId}.json`)
}

export function createPeerStore(dir) {
  const peersDir = path.join(dir, 'peers')
  return {
    async list() {
      try {
        const names = await readdir(peersDir)
        const peers = []
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          peers.push(JSON.parse(await readFile(path.join(peersDir, name), 'utf8')))
        }
        return peers
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    async get(deviceId) {
      try {
        return JSON.parse(await readFile(peerPath(dir, deviceId), 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async put(peer) {
      await mkdir(peersDir, { recursive: true })
      await writeFile(peerPath(dir, peer.deviceId), JSON.stringify(peer))
    },
    async remove(deviceId) {
      await rm(peerPath(dir, deviceId), { force: true })
    },
  }
}
