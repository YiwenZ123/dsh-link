import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createIdentityStore(dir) {
  const file = path.join(dir, 'identity.json')
  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async save(identity) {
      await mkdir(dir, { recursive: true })
      await writeFile(file, JSON.stringify(identity))
    },
  }
}
