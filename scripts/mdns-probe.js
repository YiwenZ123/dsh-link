// Read-only LAN probe for the dsh-link mDNS service: browse the service type
// from this host and (optionally) publish one advertisement to see whether the
// local network actually carries it. Run: node scripts/mdns-probe.js [seconds]
import { Bonjour } from 'bonjour-service'

const seconds = Number(process.argv[2] ?? 8)
const bonjour = new Bonjour()
const seen = new Map()

const browser = bonjour.find({ type: 'dsh-link' }, (service) => {
  const key = `${service.txt?.deviceId ?? '?'}@${service.host}:${service.port}`
  if (seen.has(key)) return
  seen.set(key, service)
  console.log(
    `found  name=${JSON.stringify(service.name)} fqdn=${service.fqdn} host=${service.host} port=${service.port}` +
      ` txt=${JSON.stringify(service.txt)} addresses=${JSON.stringify(service.addresses ?? [])}`,
  )
})

await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
browser.stop()
console.log(`browse window ${seconds}s -> ${seen.size} service(s)`)
await new Promise((resolve) => bonjour.destroy(resolve))
