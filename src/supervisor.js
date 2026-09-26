const BACKOFF = [1000, 2000, 4000, 15000]

export function createSupervisor({ peers, dial, schedule, cancel }) {
  const timers = new Map()
  const attempts = new Map()
  function peer(deviceId) {
    return peers.find((item) => item.deviceId === deviceId)
  }
  function clear(deviceId) {
    const handle = timers.get(deviceId)
    if (handle) cancel(handle)
    timers.delete(deviceId)
  }
  function arm(deviceId) {
    const current = peer(deviceId)
    if (!current?.enabled) return
    clear(deviceId)
    const step = Math.min(attempts.get(deviceId) ?? 0, BACKOFF.length - 1)
    const handle = schedule(() => {
      attempts.set(deviceId, step + 1)
      dial(current).then(() => attempts.set(deviceId, 0)).catch(() => arm(deviceId))
    }, BACKOFF[step])
    timers.set(deviceId, handle)
  }
  return {
    setEnabled(deviceId, enabled) {
      const current = peer(deviceId)
      current.enabled = enabled
      if (!enabled) {
        clear(deviceId)
        attempts.set(deviceId, 0)
        return
      }
      arm(deviceId)
    },
    noteConnected(deviceId) {
      attempts.set(deviceId, 0)
      clear(deviceId)
    },
    noteDropped(deviceId) {
      arm(deviceId)
    },
    async noteAddress(deviceId, host, port, connected) {
      const current = peer(deviceId)
      current.lastHost = host
      current.lastPort = port
      if (connected || !current.enabled) return
      // The caller is the mDNS browse callback, which has no try of its own. A
      // dial that rejects here must not escape: an unhandled rejection reaches
      // the plugin's apply() as a fatal load failure and takes dsh down with
      // it. The armed backoff already owns retrying, so the failure is dropped
      // after the record is updated.
      try {
        await dial(current)
      } catch {}
    },
    stop() {
      for (const deviceId of timers.keys()) clear(deviceId)
    },
  }
}
