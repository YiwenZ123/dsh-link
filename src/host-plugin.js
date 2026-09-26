import { startLinkService } from './link-service.js'
import { createBonjourMdns } from './mdns.js'

export const name = 'dsh-link'
export const inject = ['webServer']

export async function apply(ctx) {
  const service = await startLinkService({
    home: process.env.DSH_LINK_HOME,
    mdns: await createBonjourMdns(),
  })

  async function readBody(req) {
    let body = ''
    for await (const chunk of req) body += chunk
    return body ? JSON.parse(body) : {}
  }

  async function respond(res) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(service.snapshot()))
  }

  async function handle(fn, req, res) {
    try {
      const body = await readBody(req)
      await fn(body)
      await respond(res)
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error?.message || String(error) }))
    }
  }

  ctx.webServer.register('GET', '/dsh-link/state', async (_req, res) => {
    await respond(res)
  })
  ctx.webServer.register('POST', '/dsh-link/pair', (req, res) => handle((b) => service.pair(b.host, b.port), req, res))
  ctx.webServer.register('POST', '/dsh-link/code', (req, res) => handle((b) => service.submitCode(b.deviceId, b.code), req, res))
  ctx.webServer.register('POST', '/dsh-link/switch', (req, res) => handle((b) => service.setEnabled(b.deviceId, b.enabled), req, res))
  ctx.webServer.register('POST', '/dsh-link/unpair', (req, res) => handle((b) => service.unpair(b.deviceId), req, res))
  ctx.webServer.register('POST', '/dsh-link/discoverable', (req, res) => handle((b) => service.setDiscoverable(b.value), req, res))
  ctx.webServer.register('POST', '/dsh-link/display-name', (req, res) => handle((b) => service.setDisplayName(b.name), req, res))

  ctx.effect(() => {
    service.stop()
  })
}
