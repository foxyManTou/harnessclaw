import { useEffect, useState } from 'react'

type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

// How often to corroborate the WebSocket OPEN state with a ping/pong probe.
// Probes are a *secondary* health signal — the main process is authoritative
// for the transport lifecycle and broadcasts `harnessclaw:status` directly.
const POLL_INTERVAL_MS = 10000
// Require this many consecutive ping timeouts before downgrading the UI to
// 'disconnected'. A single 3s pong miss (transient network jitter, GC pause,
// or a slow main-thread tick) MUST NOT flip the badge — that was the source
// of the home page connected/disconnected flicker.
const PROBE_FAILURE_THRESHOLD = 2

let sharedStatus: HarnessclawStatus = 'disconnected'
let activeConsumers = 0
let monitorStarted = false
let pollTimer: number | null = null
let statusUnsubscribe: (() => void) | null = null
let probeInFlight: Promise<void> | null = null
let consecutiveProbeFailures = 0
// Monotonic version bumped on every authoritative status change. Probes
// capture the version at start and refuse to mutate state if a newer status
// event has landed in the meantime — prevents an in-flight probe from
// overwriting fresher truth from the main process.
let statusVersion = 0

const listeners = new Set<(status: HarnessclawStatus) => void>()

function emitStatus(next: HarnessclawStatus): void {
  if (sharedStatus === next) return
  sharedStatus = next
  statusVersion += 1
  listeners.forEach((listener) => listener(next))
}

async function hydrateInitialStatus(): Promise<void> {
  try {
    const current = await window.harnessclaw.getStatus()
    consecutiveProbeFailures = 0
    emitStatus(current.status as HarnessclawStatus)
  } catch {
    emitStatus('disconnected')
  }
}

async function runProbe(): Promise<void> {
  if (probeInFlight) return probeInFlight
  // Only worth probing when the main process believes we're connected. If
  // it's already 'connecting' / 'disconnected', the main process owns the
  // transition — don't shadow it with our own guess.
  if (sharedStatus !== 'connected') return

  const versionAtStart = statusVersion

  probeInFlight = (async () => {
    try {
      const probe = await window.harnessclaw.probe()

      // Stale-result guard: a `harnessclaw:status` event may have fired
      // while we were awaiting the pong. If so, don't clobber it.
      if (statusVersion !== versionAtStart || sharedStatus !== 'connected') {
        return
      }

      if (probe.ok) {
        consecutiveProbeFailures = 0
        return
      }

      consecutiveProbeFailures += 1
      if (consecutiveProbeFailures >= PROBE_FAILURE_THRESHOLD) {
        emitStatus('disconnected')
      }
      // Otherwise stay on 'connected'. The WS is still OPEN as far as main
      // knows; one missed pong isn't enough evidence to flip the badge.
    } catch {
      if (statusVersion !== versionAtStart || sharedStatus !== 'connected') {
        return
      }
      consecutiveProbeFailures += 1
      if (consecutiveProbeFailures >= PROBE_FAILURE_THRESHOLD) {
        emitStatus('disconnected')
      }
    } finally {
      probeInFlight = null
    }
  })()

  return probeInFlight
}

function startMonitor(): void {
  if (monitorStarted) return
  monitorStarted = true

  // Trust the main process's status as authoritative. It tracks the real
  // WebSocket lifecycle (`connecting` on open attempt, `connected` on
  // handshake, `disconnected` on close) and broadcasts via
  // `harnessclaw:status`. Don't trigger a follow-up probe here — that was
  // the double-emit path that flickered the UI on every reconnect.
  statusUnsubscribe = window.harnessclaw.onStatus((status) => {
    consecutiveProbeFailures = 0
    emitStatus(status as HarnessclawStatus)
  })

  void hydrateInitialStatus()

  pollTimer = window.setInterval(() => {
    if (sharedStatus === 'connected') {
      void runProbe()
    }
  }, POLL_INTERVAL_MS)
}

function stopMonitor(): void {
  if (!monitorStarted || activeConsumers > 0) return
  monitorStarted = false

  if (pollTimer != null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }

  if (statusUnsubscribe) {
    statusUnsubscribe()
    statusUnsubscribe = null
  }
}

export function useHarnessclawStatus(): HarnessclawStatus {
  const [status, setStatus] = useState<HarnessclawStatus>(sharedStatus)

  useEffect(() => {
    activeConsumers += 1
    startMonitor()

    listeners.add(setStatus)
    setStatus(sharedStatus)

    return () => {
      listeners.delete(setStatus)
      activeConsumers = Math.max(0, activeConsumers - 1)
      stopMonitor()
    }
  }, [])

  return status
}
