const SERVICE = 'dsh-link'

export function createMdns({ publish, unpublish, browse, stopBrowse }) {
  let published = null
  let listening = false
  let localDeviceId = null
  const handlers = new Set()
  return {
    start(identity) {
      localDeviceId = identity.deviceId
      if (!listening) {
        browse({ type: SERVICE }, (service) => {
          if (service.txt?.ver !== '1' || !service.txt.deviceId) return
          // Our own announcement comes back through the same browser. It is
          // not a nearby device, and echoing it would offer the user their own
          // machine to pair with.
          if (service.txt.deviceId === localDeviceId) return
          const device = {
            deviceId: service.txt.deviceId,
            displayName: service.txt.displayName,
            host: service.host,
            port: service.port,
          }
          for (const handler of handlers) handler(device)
        })
        listening = true
      }
      if (!identity.discoverable) {
        if (published) unpublish(published)
        published = null
        return
      }
      // A probe conflict stops the advertisement without telling us. That
      // costs discovery only: the listen port is still open and manual
      // addresses still work, so publishing is never allowed to fail start().
      try {
        published = publish({
          name: `${identity.displayName} (${String(identity.deviceId).slice(0, 8)})`,
          type: SERVICE,
          port: identity.listenPort,
          txt: { deviceId: identity.deviceId, displayName: identity.displayName, ver: '1' },
        })
      } catch (error) {
        published = null
        console.warn(`dsh-link: advertising ${SERVICE} failed (${error?.message || error}); use a manual address instead`)
      }
    },
    stop() {
      if (published) unpublish(published)
      published = null
      if (listening) stopBrowse()
      listening = false
    },
    onNearby(handler) {
      handlers.add(handler)
    },
  }
}

export async function createBonjourMdns() {
  const { Bonjour } = await import('bonjour-service')
  const bonjour = new Bonjour()
  let browser = null
  return createMdns({
    publish: (service) => bonjour.publish(service),
    unpublish: (service) => service.stop(),
    browse: (query, onService) => {
      browser = bonjour.find(query, onService)
    },
    stopBrowse: () => browser?.stop(),
  })
}
