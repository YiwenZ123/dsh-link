export function createPairingAttempt() {
  let failures = 0
  let lockedUntil = 0
  return {
    isLocked(now) {
      return now < lockedUntil
    },
    recordFailure(now) {
      if (now >= lockedUntil) failures += 1
      if (failures >= 5) {
        failures = 0
        lockedUntil = now + 60_000
      }
      return { locked: now < lockedUntil }
    },
    recordSuccess() {
      failures = 0
      lockedUntil = 0
    },
  }
}
