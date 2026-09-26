import { readFile } from 'node:fs/promises'

// Windows editors and PowerShell's `-Encoding utf8` prepend a BOM, which
// JSON.parse rejects. A stray BOM in a state file must not fail host boot.
export async function readJson(file) {
  const text = await readFile(file, 'utf8')
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}
