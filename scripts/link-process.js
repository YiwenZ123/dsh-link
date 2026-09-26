import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLinkService } from '../src/link-service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

async function respond(res, service) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(service.snapshot()))
}

async function handle(fn, req, res, service) {
  try {
    const body = await readBody(req)
    await fn(body)
    await respond(res, service)
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: error?.message || String(error) }))
  }
}

function buildRoutes(service) {
  return [
    {
      method: 'GET',
      path: '/dsh-link/state',
      handler: (req, res) => respond(res, service),
    },
    {
      method: 'POST',
      path: '/dsh-link/pair',
      handler: (req, res) => handle((b) => service.pair(b.host, b.port), req, res, service),
    },
    {
      method: 'POST',
      path: '/dsh-link/code',
      handler: (req, res) => handle((b) => service.submitCode(b.deviceId, b.code), req, res, service),
    },
    {
      method: 'POST',
      path: '/dsh-link/switch',
      handler: (req, res) => handle((b) => service.setEnabled(b.deviceId, b.enabled), req, res, service),
    },
    {
      method: 'POST',
      path: '/dsh-link/unpair',
      handler: (req, res) => handle((b) => service.unpair(b.deviceId), req, res, service),
    },
    {
      method: 'POST',
      path: '/dsh-link/discoverable',
      handler: (req, res) => handle((b) => service.setDiscoverable(b.value), req, res, service),
    },
    {
      method: 'POST',
      path: '/dsh-link/display-name',
      handler: (req, res) => handle((b) => service.setDisplayName(b.name), req, res, service),
    },
  ]
}

async function main() {
  const home = process.env.DSH_LINK_HOME
  const listenPort = Number(process.env.DSH_LINK_PORT || 0)
  const service = await startLinkService({ home, listenPort })

  const routes = buildRoutes(service)
  const httpServer = http.createServer(async (req, res) => {
    for (const route of routes) {
      if (req.url !== route.path) continue
      if (req.method !== route.method) {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      try {
        await route.handler(req, res)
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: error?.message || String(error) }))
        }
      }
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.removeListener('error', reject)
      resolve()
    })
  })

  const uiPort = httpServer.address().port
  const linkPort = service.snapshot().local.port
  process.stdout.write(`${JSON.stringify({ port: linkPort, uiPort })}\n`)

  const shutdown = async () => {
    try { await service.stop() } catch {}
    try { httpServer.close() } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
