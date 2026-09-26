export function createMdns({ publish, unpublish, browse, stopBrowse }) {
  let published = null
  let listening = false
  const handlers = new Set()
  return {
    start(identity) {
      if (!listening) {
        browse({ type: 'dsh-link' }, (service) => {
          if (service.txt?.ver !== '1' || !service.txt.deviceId) return
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
      published = publish({
        name: identity.deviceId,
        type: 'dsh-link',
        port: identity.listenPort,
        txt: { deviceId: identity.deviceId, displayName: identity.displayName, ver: '1' },
      })
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
