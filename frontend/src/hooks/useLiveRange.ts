import { useEffect, useMemo, useState } from 'react'

const REFRESH_MS = 10_000
const DEFAULT_WINDOW_MS = 60 * 60 * 1000 // rolling last hour

// floor to the refresh interval so the query keys stay stable within a tick
function flooredNow(): number {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

export interface LiveRange {
  live: boolean
  /** Always a closed window: rate and percentile maths cannot work with an open end. */
  range: { from: string; to: string }
  toggleLive: () => void
  /** Picking a range by hand leaves live mode — an explicit window contradicts "now". */
  setRange: (next: { from: string | undefined; to: string | undefined }) => void
}

/**
 * The rolling window every time-ranged page shares. Nothing here polls: the ticking `now`
 * moves the range, the range is part of every query key, and React Query refetches because
 * of that — so a page gets live data by using this hook and nothing else.
 */
export function useLiveRange(options: { windowMs?: number; initialLive?: boolean } = {}): LiveRange {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const [live, setLive] = useState(options.initialLive ?? true)
  const [now, setNow] = useState(flooredNow)
  const [frozen, setFrozen] = useState<{ from: string; to: string } | null>(null)

  const liveRange = useMemo(
    () => ({ from: new Date(now - windowMs).toISOString(), to: new Date(now).toISOString() }),
    [now, windowMs],
  )
  const range = live ? liveRange : (frozen ?? liveRange)

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [live])

  function toggleLive() {
    if (live) {
      // pausing keeps the window the user was looking at, rather than jumping
      setFrozen(range)
      setLive(false)
      return
    }
    setNow(flooredNow())
    setFrozen(null)
    setLive(true)
  }

  function setRange(next: { from: string | undefined; to: string | undefined }) {
    if (!next.from) return
    // presets leave `to` open-ended; pin it to now so the window stays closed
    setFrozen({ from: next.from, to: next.to ?? new Date().toISOString() })
    setLive(false)
  }

  return { live, range, toggleLive, setRange }
}
