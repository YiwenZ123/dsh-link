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
      if (!connected && current.enabled) await dial(current)
    },
    stop() {
      for (const deviceId of timers.keys()) clear(deviceId)
    },
  }
}
