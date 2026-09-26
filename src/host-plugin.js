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

  const disposers = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      await respond(res)
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/pair',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      return handle((b) => service.pair(b.host, b.port), req, res)
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/code',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      return handle((b) => service.submitCode(b.deviceId, b.code), req, res)
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/switch',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      return handle((b) => service.setEnabled(b.deviceId, b.enabled), req, res)
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/unpair',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      return handle((b) => service.unpair(b.deviceId), req, res)
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/discoverable',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      return handle((b) => service.setDiscoverable(b.value), req, res)
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-link/display-name',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      return handle((b) => service.setDisplayName(b.name), req, res)
    },
  }))

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch {}
    }
    return service.stop()
  })
}
