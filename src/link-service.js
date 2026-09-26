import { createIdentityStore } from './identity-store.js'
import { createPeerStore } from './peer-store.js'
import { generateIdentity } from './keys.js'
import { createHandshake } from './handshake.js'
import { createPairingAttempt } from './pairing-attempt.js'
import { createSupervisor } from './supervisor.js'
import { chooseWinner, dial as defaultDial, listen as defaultListen } from './wire.js'
import { createMdns } from './mdns.js'
import { decodeFrame, encodeFrame } from './frames.js'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_LISTEN_PORT = 48721
const PORT_RANGE_SIZE = 10
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/
// RFC 2544's benchmark range, which a proxy in fake-IP mode hands out for names
// it cannot answer. Such an address is syntactically fine and never answers, so
// it must not replace a record's real address.
const FAKE_IP_RE = /^198\.18\./

const noopMdns = createMdns({
  publish: () => null,
  unpublish: () => {},
  browse: () => {},
  stopBrowse: () => {},
})

function shortId(deviceId) {
  return String(deviceId).slice(0, 8)
}

function statusFor(peer, conns) {
  if (!peer) return 'unpaired'
  if (!peer.enabled) return 'disabled'
  const conn = conns.get(peer.deviceId)
  if (conn?.state === 'open') return 'connected'
  if (peer.failed) return 'failed'
  return peer.hadConnected ? 'reconnecting' : 'connecting'
}

/**
 * The port to dial for one peer, in order of evidence:
 * 1. the port a connection to this peer actually completed on;
 * 2. the listener it announced on the connection that just dropped — fresher
 *    than anything on disk, and the only source of truth for a dial-in peer
 *    whose source port landed in `lastPort`;
 * 3. the listener stored with the record;
 * 4. the stored port itself, which is all a version 1 peer that never
 *    announced anything has.
 * @param peer - the stored peer record.
 * @param connectedPort - a port that completed a handshake, if we have seen one.
 * @param declaredPort - the port this peer announced on the latest connection.
 * @returns the port to dial.
 */
function portToDial(peer, connectedPort, declaredPort) {
  if (connectedPort !== undefined) return connectedPort
  if (declaredPort !== undefined) return declaredPort
  if (peer.listenPort !== undefined) return peer.listenPort
  return peer.lastPort
}

/**
 * Whether the advertised address accepts a connection right now. A browse
 * result can outlive the process that published it, and offering a dead host
 * to pair with is worse than showing nothing.
 * @param host - the advertised host name or address.
 * @param port - the advertised port.
 * @param timeoutMs - how long to wait before calling it unreachable.
 * @returns true when a TCP connection completed.
 */
function isReachable(host, port, timeoutMs = 1500) {
  if (!host || !Number.isInteger(port) || port < 1) return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (reachable) => {
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function resolveCollision(localDeviceId, remoteDeviceId, conn, existing) {
  // chooseWinner returns 'local' when the connection dialed by this
  // machine should be kept, and 'remote' when the connection dialed by
  // the peer should be kept. Map that onto conn/existing using each
  // socket's own localDialed flag — neither conn nor existing is
  // always the locally-dialed one.
  const winner = chooseWinner({ localDeviceId, remoteDeviceId, localDialed: conn.localDialed })
  const localDialedConn = conn.localDialed ? conn : existing
  const remoteDialedConn = conn.localDialed ? existing : conn
  const keeper = winner === 'local' ? localDialedConn : remoteDialedConn
  const loser = keeper === conn ? existing : conn
  return { keeper, loser, winner }
}

export async function startLinkService({
  home,
  listenPort = 0,
  dialImpl = defaultDial,
  listenImpl = defaultListen,
  mdns = noopMdns,
} = {}) {
  const linkHome = home || path.join(os.homedir(), '.dsh', 'link')
  const identityStore = createIdentityStore(linkHome)
  const peerStore = createPeerStore(linkHome)

  let identity = await identityStore.load()
  if (!identity) {
    identity = generateIdentity({ listenPort: listenPort || DEFAULT_LISTEN_PORT })
    await identityStore.save(identity)
  }

  const savedPort = identity.listenPort && identity.listenPort > 0 ? identity.listenPort : 0
  const bindPort = listenPort === 0 ? savedPort : listenPort

  const conns = new Map() // deviceId -> conn (or socket->conn until deviceId known)
  const pending = new Map() // deviceId -> { deviceId, role, code, host, port }
  let peers = await peerStore.list()
  const nearby = new Map() // deviceId -> { deviceId, displayName, host, port }
  const attempts = new Map() // deviceId -> attempt
  const declaredPorts = new Map() // deviceId -> the listenPort its hello announced
  const connectedPorts = new Map() // deviceId -> the port a completed connection used
  const pairResolvers = new Map() // tempKey -> resolve
  const outcomeResolvers = new Map() // deviceId -> resolve
  let stopped = false

  function getAttempt(deviceId) {
    let attempt = attempts.get(deviceId)
    if (!attempt) {
      attempt = createPairingAttempt()
      attempts.set(deviceId, attempt)
    }
    return attempt
  }

  function snapshot() {
    const local = {
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      shortId: shortId(identity.deviceId),
      port: identity.listenPort,
      discoverable: identity.discoverable,
    }
    const peersView = peers.map((peer) => ({
      deviceId: peer.deviceId,
      displayName: peer.displayName,
      status: statusFor(peer, conns),
      lastHost: peer.lastHost,
      lastPort: peer.lastPort,
      enabled: peer.enabled,
      failure: peer.failure || null,
    }))
    const pendingView = [...pending.values()].map((entry) => ({ ...entry }))
    const nearbyView = [...nearby.values()].map((item) => ({ ...item }))
    return { local, peers: peersView, pending: pendingView, nearby: nearbyView }
  }

  function findPeer(deviceId) {
    return peers.find((peer) => peer.deviceId === deviceId) || null
  }

  /**
   * The address to remember for a peer we just reached. A host name is only
   * dialable through multicast DNS, and a machine whose resolver answers with
   * something else — a VPN adapter, a proxy's fake-IP range — turns every
   * later redial into a connection to a dead address while the record still
   * looks valid. A literal address outranks a name: the address that was
   * dialed when it is one, otherwise the remote address the socket carries.
   * @param host - the address this connection was dialed or accepted on.
   * @param socket - the socket that completed the handshake.
   * @returns the address to store in the peer record.
   */
  function literalAddress(value) {
    return typeof value === 'string' && IPV4_RE.test(value) && !FAKE_IP_RE.test(value)
  }

  function dialableHost(host, socket) {
    if (literalAddress(host)) return host
    const remote = socket?._socket?.remoteAddress?.replace(/^::ffff:/, '')
    return literalAddress(remote) ? remote : host
  }

  async function persistPeer(peer) {
    await peerStore.put(peer)
    const existing = peers.find((item) => item.deviceId === peer.deviceId)
    if (existing) Object.assign(existing, peer)
    else peers.push(peer)
  }

  async function removePeer(deviceId) {
    await peerStore.remove(deviceId)
    peers = peers.filter((peer) => peer.deviceId !== deviceId)
  }

  function closeConn(deviceId) {
    const conn = conns.get(deviceId)
    if (!conn) return
    conns.delete(deviceId)
    pending.delete(deviceId)
    pairResolvers.delete(deviceId)
    outcomeResolvers.delete(deviceId)
    try { conn.socket.close() } catch {}
  }

  function registerConn(conn, key) {
    for (const [k, value] of conns.entries()) {
      // Re-keying THIS connection (inbound: socket key -> the deviceId its
      // hello revealed; outbound: a placeholder -> the real one). Removing the
      // old key first is what keeps the collision branch below for two
      // genuinely different sockets racing to the same deviceId.
      if (value === conn) { conns.delete(k); break }
    }
    const existing = conns.get(key)
    if (existing && existing !== conn) {
      const { keeper, loser } = resolveCollision(identity.deviceId, key, conn, existing)
      loser.collisionLoser = true
      loser.socket.suppressPeerClose = true
      try { loser.socket.close() } catch {}
      pending.delete(key)
      pairResolvers.delete(key)
      if (loser === conn) {
        // We are the loser; keep the existing conn registered.
        return false
      }
      conns.delete(key)
    }
    conns.set(key, conn)
    return true
  }

  function rekeyConn(conn, newKey) {
    return registerConn(conn, newKey)
  }

  function makeHandshake(socket, role, knownPeer, attemptKey) {
    return createHandshake({
      role,
      identity,
      knownPeer,
      attempt: getAttempt(attemptKey),
      now: () => Date.now(),
      send: (message) => {
        if (socket.readyState === 1) socket.send(encodeFrame(message))
      },
    })
  }

  function setupSocket(socket, localDialed, remoteHost, remotePort, knownPeer, fallbackPort, targetPort) {
    const role = localDialed ? 'initiator' : 'acceptor'
    let handshake = makeHandshake(socket, role, knownPeer, knownPeer?.deviceId || 'pending')
    const conn = {
      socket,
      state: 'connecting',
      handshake,
      role,
      localDialed,
      knownPeer,
      host: remoteHost,
      port: remotePort,
      targetPort,
      announcedPort: null,
      fallbackPort,
      remoteDeviceId: knownPeer?.deviceId || null,
    }
    if (knownPeer) {
      // An outgoing reconnect dial may collide with an inbound connection
      // already registered under the same deviceId. Resolve it now.
      if (!registerConn(conn, knownPeer.deviceId)) return conn
    } else {
      conns.set(socket, conn)
    }

    socket.on('message', (data) => {
      let message
      try { message = decodeFrame(String(data)) } catch { return }
      if (handshake.phase === 'open') {
        // After auth, decode and drop delegate.* and resume. No-op.
        return
      }
      // Capture remote deviceId from hello to re-key conn and pending.
      if (message.type === 'hello' && !conn.remoteDeviceId) {
        conn.remoteDeviceId = message.deviceId
        // Protocol version 1 carries no listenPort; record its absence so a
        // redial does not invent a port that peer never announced.
        const announced = Number.isInteger(message.listenPort) ? message.listenPort : null
        conn.announcedPort = announced
        if (announced !== null) declaredPorts.set(message.deviceId, announced)
        else declaredPorts.delete(message.deviceId)
        const kept = rekeyConn(conn, message.deviceId)
        if (!kept) return
        if (pending.has(socket)) {
          const entry = pending.get(socket)
          pending.delete(socket)
          entry.deviceId = message.deviceId
          pending.set(message.deviceId, entry)
        }
        // For incoming connections, look up known peer by deviceId and
        // recreate the handshake so reconnection does challenge-response
        // instead of pair.confirm.
        if (role === 'acceptor' && !knownPeer) {
          const peer = findPeer(message.deviceId)
          if (peer && peer.publicKey === message.publicKey) {
            conn.knownPeer = peer
            handshake = makeHandshake(socket, 'acceptor', peer, message.deviceId)
            conn.handshake = handshake
          }
        }
        if (role === 'acceptor') {
          if (!pending.has(message.deviceId)) {
            // Placeholder until the handshake can compute the code in this
            // same turn; the block below fills it in.
            pending.set(message.deviceId, {
              deviceId: message.deviceId,
              role: 'acceptor',
              code: null,
              host: remoteHost,
              port: remotePort,
            })
          }
        }
      }
      handshake.receive(message)
      const code = handshake.code
      if (code) {
        // The code exists from the first hello on, but the pending entry is
        // created in the same turn that hello arrives — look it up by the
        // remote deviceId, never by a key snapshot taken before receive().
        const devId = conn.remoteDeviceId
        if (devId) {
          const existing = pending.get(devId)
          if (role === 'initiator') {
            pending.set(devId, {
              deviceId: devId,
              role: 'initiator',
              code,
              host: remoteHost,
              port: remotePort,
            })
            const resolve = pairResolvers.get(socket) || pairResolvers.get(devId)
            if (resolve) {
              pairResolvers.delete(socket)
              pairResolvers.delete(devId)
              resolve()
            }
          } else if (existing) {
            // The acceptor side shows a code-entry row for this pairing, so
            // the entry has to carry the code as soon as it is computable.
            existing.code = code
          } else {
            pending.set(devId, {
              deviceId: devId,
              role: 'acceptor',
              code,
              host: remoteHost,
              port: remotePort,
            })
          }
        }
      }
      if (handshake.outcome) handleOutcome(conn, handshake.outcome)
    })

    socket.on('close', () => handleSocketClose(conn))
    socket.on('error', () => handleSocketClose(conn))

    if (role === 'initiator') handshake.start()
    return conn
  }

  async function handleOutcome(conn, outcome) {
    const peerId = outcome.peer?.deviceId
    if (outcome.ok) {
      const existing = findPeer(peerId)
      // The port that reaches this peer: what its own hello announced when it
      // dialed in (its source port would otherwise be recorded instead), else
      // the local port of the socket that just authenticated.
      const announced = outcome.peer.listenPort ?? conn.announcedPort
      const listenPort = announced ?? conn.targetPort ?? conn.fallbackPort ?? conn.port
      const updated = {
        deviceId: outcome.peer.deviceId,
        displayName: outcome.peer.displayName,
        publicKey: outcome.peer.publicKey,
        lastHost: dialableHost(conn.host, conn.socket),
        lastPort: listenPort,
        listenPort,
        // A connection that authenticates is not consent to be connected: the
        // peer dials back the moment the switch closes the socket, and writing
        // `true` here flipped the switch back on by itself.
        enabled: existing?.enabled ?? true,
        pairedAt: existing?.pairedAt || Date.now(),
        hadConnected: true,
        failed: false,
        failure: null,
      }
      // Persist on success, not only on enable/disable: a record left at the
      // ephemeral port it was first written with is the dead address every
      // later redial would use.
      await persistPeer(updated)
      connectedPorts.set(peerId, listenPort)
      conn.remoteDeviceId = peerId
      conn.state = 'open'
      pending.delete(peerId)
      supervisor.noteConnected(peerId)
      const resolve = outcomeResolvers.get(peerId)
      if (resolve) { outcomeResolvers.delete(peerId); resolve() }
    } else {
      const failId = conn.remoteDeviceId || conn.knownPeer?.deviceId || peerId
      const peerRecord = failId ? findPeer(failId) : null
      if (peerRecord) {
        peerRecord.failed = true
        if (outcome.reason === '地址不可达' || outcome.reason === '密钥不符' || outcome.reason === '版本不一致') {
          peerRecord.failure = outcome.reason
        }
      }
      pending.delete(failId)
      const resolve = outcomeResolvers.get(failId)
      if (resolve) { outcomeResolvers.delete(failId); resolve() }
    }
  }

  function handleSocketClose(conn) {
    for (const [key, value] of conns.entries()) {
      if (value === conn) { conns.delete(key); break }
    }
    const deviceId = conn.remoteDeviceId
    pending.delete(deviceId)
    pairResolvers.delete(deviceId)
    const peer = findPeer(deviceId)
    if (peer && peer.enabled && !stopped && !conn.collisionLoser) {
      const keeper = conns.get(deviceId)
      if (!keeper || keeper.socket.readyState !== 1) {
        peer.failed = false
        peer.failure = null
        supervisor.noteDropped(deviceId)
      }
    }
  }

  const supervisor = createSupervisor({
    peers,
    dial: async (peer) => {
      const declared = declaredPorts.get(peer.deviceId)
      const port = portToDial(peer, connectedPorts.get(peer.deviceId), declared)
      // One extra attempt, not a second retry loop: the stored port may be a
      // peer's ephemeral source port, and the fallback is a port it announced
      // on the authenticated connection. The backoff schedule is unchanged.
      const fallback = port !== peer.listenPort && peer.listenPort !== undefined ? peer.listenPort : undefined
      try {
        const socket = await dialImpl({ host: peer.lastHost, port })
        setupSocket(socket, true, peer.lastHost, port, peer, fallback, port)
      } catch (error) {
        peer.failed = true
        peer.failure = '地址不可达'
        if (fallback === undefined) throw error
        let socket
        try {
          socket = await dialImpl({ host: peer.lastHost, port: fallback })
        } catch {
          throw error
        }
        setupSocket(socket, true, peer.lastHost, fallback, peer)
      }
    },
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle),
  })

  async function startServer(port) {
    const id = { ...identity, listenPort: port }
    return listenImpl(id, (socket, req) => {
      const host = req?.socket?.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1'
      const rport = req?.socket?.remotePort || 0
      setupSocket(socket, false, host, rport, null)
    })
  }

  // A half-open range, not one port and not the OS ephemeral pool: an inbound
  // rule can name the whole range, and restart-to-restart the bind lands in
  // the same few ports instead of a random high one.
  async function bindPortInRange(preferred) {
    for (let port = preferred; port < preferred + PORT_RANGE_SIZE; port += 1) {
      try {
        return await startServer(port)
      } catch (error) {
        if (error.code !== 'EADDRINUSE' && !/EADDRINUSE/.test(error.message || '')) throw error
      }
    }
    return startServer(0)
  }

  const server = await bindPortInRange(bindPort > 0 ? bindPort : DEFAULT_LISTEN_PORT)

  if (server.port !== identity.listenPort) {
    identity.listenPort = server.port
    await identityStore.save(identity)
  }

  mdns.onNearby((device) => {
    if (!device?.deviceId) return
    // The browse stream carries this machine's own announcement too.
    if (device.deviceId === identity.deviceId) return
    const peer = findPeer(device.deviceId)
    if (peer) {
      const conn = conns.get(device.deviceId)
      const connected = !!conn && conn.state === 'open' && conn.socket?.readyState === 1
      supervisor.noteAddress(device.deviceId, device.host, device.port, connected)
      return
    }
    // An unpaired candidate is only offered while it actually answers: a
    // browse record survives the process that published it.
    isReachable(device.host, device.port).then((ok) => {
      if (stopped) return
      if (!ok) {
        nearby.delete(device.deviceId)
        return
      }
      nearby.set(device.deviceId, {
        deviceId: device.deviceId,
        displayName: device.displayName,
        host: device.host,
        port: device.port,
      })
    })
  })

  // Announce only after the real bound port is known: `identity.listenPort`
  // is written back just above, so the advertisement names a port that is
  // actually accepting, including when the bind fell back to an ephemeral one.
  mdns.start(identity)

  /** The address predicate, exposed so a test can assert it without a peer. */
  function __literalAddress(value) {
    return literalAddress(value)
  }

  async function pair(host, port) {
    const socket = await dialImpl({ host, port })
    const codeReady = new Promise((resolve) => pairResolvers.set(socket, resolve))
    const closed = new Promise((resolve, reject) => {
      socket.once('close', () => reject(new Error('地址不可达')))
    })
    setupSocket(socket, true, host, port, null)
    await Promise.race([codeReady, closed])
  }

  async function submitCode(deviceId, code) {
    const conn = conns.get(deviceId)
    if (!conn) throw new Error('no pending pairing')
    const key = conn.remoteDeviceId || deviceId
    const done = new Promise((resolve) => outcomeResolvers.set(key, resolve))
    conn.handshake.submitCode(code)
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))])
  }

  async function setEnabled(deviceId, enabled) {
    const peer = findPeer(deviceId)
    if (!peer) return
    peer.enabled = enabled
    peer.failed = false
    peer.failure = null
    await peerStore.put(peer)
    if (!enabled) {
      closeConn(deviceId)
      peer.failed = false
      peer.failure = null
      supervisor.setEnabled(deviceId, false)
    } else {
      supervisor.setEnabled(deviceId, true)
    }
    await peerStore.put(peer)
  }

  async function unpair(deviceId) {
    closeConn(deviceId)
    supervisor.setEnabled(deviceId, false)
    await removePeer(deviceId)
  }

  async function setDiscoverable(value) {
    identity.discoverable = value
    await identityStore.save(identity)
    mdns.start(identity)
  }

  async function setDisplayName(name) {
    identity.displayName = name
    await identityStore.save(identity)
    mdns.start(identity)
  }

  async function stop() {
    stopped = true
    supervisor.stop()
    mdns.stop()
    for (const key of [...conns.keys()]) {
      const conn = conns.get(key)
      try { conn.socket.close() } catch {}
      conns.delete(key)
    }
    pending.clear()
    pairResolvers.clear()
    outcomeResolvers.clear()
    if (server) await server.close()
  }

  return {
    snapshot,
    __literalAddress,
    pair,
    submitCode,
    setEnabled,
    unpair,
    setDiscoverable,
    setDisplayName,
    stop,
  }
}

export function __resolveCollision(localDeviceId, remoteDeviceId, conn, existing) {
  return resolveCollision(localDeviceId, remoteDeviceId, conn, existing)
}

export function __portToDial(peer, connectedPort, declaredPort) {
  return portToDial(peer, connectedPort, declaredPort)
}

