import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readJson } from './read-json.js'

export function createIdentityStore(dir) {
  const file = path.join(dir, 'identity.json')
  return {
    async load() {
      try {
        return await readJson(file)
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async save(identity) {
      await mkdir(dir, { recursive: true })
      await writeFile(file, JSON.stringify(identity), { mode: 0o600 })
    },
  }
}
