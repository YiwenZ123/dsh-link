import { createIdentityStore } from './identity-store.js'
import { createPeerStore } from './peer-store.js'
import { generateIdentity } from './keys.js'
import { createHandshake } from './handshake.js'
import { createPairingAttempt } from './pairing-attempt.js'
import { createSupervisor } from './supervisor.js'
import { chooseWinner, dial as defaultDial, listen as defaultListen } from './wire.js'
import { createMdns } from './mdns.js'
import { decodeFrame, encodeFrame } from './frames.js'

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

export async function startLinkService({
  home,
  listenPort = 0,
  dialImpl = defaultDial,
  listenImpl = defaultListen,
  mdns = noopMdns,
} = {}) {
  const identityStore = createIdentityStore(home)
  const peerStore = createPeerStore(home)

  let identity = await identityStore.load()
  if (!identity) {
    identity = generateIdentity({ listenPort: listenPort || 48721 })
    await identityStore.save(identity)
  }

  const savedPort = identity.listenPort && identity.listenPort > 0 ? identity.listenPort : 0
  const bindPort = listenPort === 0 ? savedPort : listenPort
  const bindIdentity = { ...identity, listenPort: bindPort }

  const conns = new Map() // deviceId -> conn (or socket->conn until deviceId known)
  const pending = new Map() // deviceId -> { deviceId, role, code, host, port }
  let peers = await peerStore.list()
  const attempts = new Map() // deviceId -> attempt
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
    }))
    const pendingView = [...pending.values()].map((entry) => ({ ...entry }))
    return { local, peers: peersView, pending: pendingView }
  }

  function findPeer(deviceId) {
    return peers.find((peer) => peer.deviceId === deviceId) || null
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

  function rekeyConn(conn, newKey) {
    for (const [key, value] of conns.entries()) {
      if (value === conn) {
        conns.delete(key)
        break
      }
    }
    const existing = conns.get(newKey)
    if (existing && existing !== conn) {
      // Two connections for the same deviceId: pick the winner, close the loser.
      const winner = chooseWinner({
        localDeviceId: identity.deviceId,
        remoteDeviceId: newKey,
        localDialed: conn.localDialed,
      })
      const loser = winner === 'local' ? existing : conn
      const keeper = winner === 'local' ? conn : existing
      try { loser.socket.close() } catch {}
      pending.delete(newKey)
      pairResolvers.delete(newKey)
      if (loser === conn) {
        // We are the loser; keep the existing conn registered.
        return false
      }
      conns.delete(newKey)
    }
    conns.set(newKey, conn)
    return true
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

  function setupSocket(socket, localDialed, remoteHost, remotePort, knownPeer) {
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
      remoteDeviceId: knownPeer?.deviceId || null,
    }
    conns.set(knownPeer?.deviceId || socket, conn)

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
          } else if (!existing) {
            pending.set(devId, {
              deviceId: devId,
              role: 'acceptor',
              code: null,
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
      const updated = {
        deviceId: outcome.peer.deviceId,
        displayName: outcome.peer.displayName,
        publicKey: outcome.peer.publicKey,
        lastHost: conn.host,
        lastPort: conn.port,
        enabled: true,
        pairedAt: existing?.pairedAt || Date.now(),
        hadConnected: true,
      }
      await persistPeer(updated)
      const peerRecord = findPeer(peerId)
      if (peerRecord) peerRecord.hadConnected = true
      conn.remoteDeviceId = peerId
      conn.state = 'open'
      pending.delete(peerId)
      supervisor.noteConnected(peerId)
      const resolve = outcomeResolvers.get(peerId)
      if (resolve) { outcomeResolvers.delete(peerId); resolve() }
    } else {
      const peerRecord = findPeer(peerId)
      if (peerRecord) {
        peerRecord.failed = true
        peerRecord.failReason = outcome.reason || 'failed'
      }
      pending.delete(peerId)
      const resolve = outcomeResolvers.get(peerId)
      if (resolve) { outcomeResolvers.delete(peerId); resolve() }
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
    if (peer && peer.enabled && !stopped) {
      peer.failed = false
      supervisor.noteDropped(deviceId)
    }
  }

  const supervisor = createSupervisor({
    peers,
    dial: async (peer) => {
      try {
        const socket = await dialImpl({ host: peer.lastHost, port: peer.lastPort })
        setupSocket(socket, true, peer.lastHost, peer.lastPort, peer)
      } catch (error) {
        peer.failed = true
        peer.failReason = '地址不可达'
        throw error
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

  let server
  try {
    server = await startServer(bindPort)
  } catch (error) {
    if ((error.code === 'EADDRINUSE' || /EADDRINUSE/.test(error.message || '')) && bindPort !== 0) {
      server = await startServer(0)
    } else {
      throw error
    }
  }

  if (server.port !== identity.listenPort) {
    identity.listenPort = server.port
    await identityStore.save(identity)
  }

  mdns.start(identity)

  async function pair(host, port) {
    const socket = await dialImpl({ host, port })
    const conn = setupSocket(socket, true, host, port, null)
    const codeReady = new Promise((resolve) => pairResolvers.set(socket, resolve))
    const closed = new Promise((resolve, reject) => {
      socket.once('close', () => reject(new Error('地址不可达')))
    })
    await Promise.race([codeReady, closed])
  }

  async function submitCode(deviceId, code) {
    let conn = conns.get(deviceId)
    if (!conn) {
      for (const value of conns.values()) {
        if (value.role === 'acceptor') { conn = value; break }
      }
    }
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
    await peerStore.put(peer)
    if (!enabled) {
      closeConn(deviceId)
      peer.failed = false
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
    pair,
    submitCode,
    setEnabled,
    unpair,
    setDiscoverable,
    setDisplayName,
    stop,
  }
}
