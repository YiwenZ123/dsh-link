const SERVICE = 'dsh-link'

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/
/**
 * The benchmark range RFC 2544 reserves, which a proxy in fake-IP mode hands
 * out for every name it does not have a real answer for — Clash and its forks
 * use it by default. Measured on the pair: this Mac's own `.local` name
 * resolved to `198.18.0.56` on the Windows side while `192.168.3.118` was
 * reachable, so a record holding the name dialed a dead address forever while
 * looking perfectly valid.
 */
const FAKE_IP_RE = /^198\.18\./

/**
 * Whether a browse result carries an address a dial can use. Both filters
 * matter: a name is only dialable through multicast DNS, which a proxy can
 * intercept, and the interception is silent — the address it hands out is
 * syntactically fine and simply never answers.
 * @param address - one entry from a browse result's `addresses`.
 * @returns true for a literal IPv4 outside the fake-IP range.
 */
function usableAddress(address) {
  return typeof address === 'string' && IPV4_RE.test(address) && !FAKE_IP_RE.test(address)
}

/**
 * A browse result's usable address, preferring a literal IPv4 over the
 * advertised host name. A host name outranks nothing: the callers fall back
 * to a manual address when this returns undefined, which is honest, whereas
 * storing a name that the resolver poisons produces a record that looks
 * connected and never is.
 * @param service - one browse result.
 * @returns the address to dial, or undefined when the result offers none.
 */
function dialableHost(service) {
  const addresses = Array.isArray(service.addresses) ? service.addresses : []
  return addresses.find(usableAddress)
}

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
          const host = dialableHost(service)
          // An advertisement with no usable address is not a device we can
          // reach. Reporting it would put a row in front of the user that
          // cannot connect; a manual address stays available for exactly this.
          if (host === undefined) return
          const device = {
            deviceId: service.txt.deviceId,
            displayName: service.txt.displayName,
            host,
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
      // The instance name must identify this device, not describe it. Two
      // machines that share a display name — the common case, since both read
      // the same host name pattern — collide here, and the responder keeps the
      // first claim and silently drops the second: the other side's switch
      // looks on while nothing is ever advertised, and no JS error is raised
      // for the catch below to report. The device id is unique, and the name a
      // human reads is the txt `displayName`, which browse results carry.
      try {
        published = publish({
          name: `dsh-link-${String(identity.deviceId).slice(0, 8)}`,
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
