import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const REFRESH_MS = 10_000
const DEFAULT_WINDOW_MS = 60 * 60 * 1000 // rolling last hour

// floor to the refresh interval so the query keys stay stable within a tick
function flooredNow(): number {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

/** The window as the picker models it: either end may be open. */
export interface OpenRange {
  from: string | undefined
  to: string | undefined
}

export interface LiveRange {
  live: boolean
  /** Always a closed window: rate and percentile maths cannot work with an open end. */
  range: { from: string; to: string }
  toggleLive: () => void
  /** Picking a range by hand leaves live mode — an explicit window contradicts "now". */
  setRange: (next: OpenRange) => void
}

interface TimeRangeStore {
  live: boolean
  /** What the reader last chose, once live mode was left. Null while live. */
  frozen: OpenRange | null
  now: number
  toggleLive: () => void
  setRange: (next: OpenRange) => void
}

const TimeRangeContext = createContext<TimeRangeStore | null>(null)

/**
 * One time window for the whole app.
 *
 * It used to be one `useLiveRange()` per page, which meant the range reset every time the
 * reader moved between pages: narrow the dashboard to a bad ten minutes, click through to
 * Requests, and you were back to the last hour with nothing to say which ten minutes you had
 * been looking at. The window is a property of what the reader is investigating, not of the
 * page they happen to be on.
 *
 * Deliberately not persisted, and mounted *inside* LoginGate: a fresh sign-in starts at the
 * default rather than resuming a window from whoever was here before. Live starts off — an
 * hour of history is the useful first thing to see, and a page that started moving on its own
 * before anyone asked was the complaint that prompted this.
 */
export function TimeRangeProvider({
  children,
  initialRange,
}: {
  children: ReactNode
  /** Overrides the default opening window. Tests use it so an assertion about a per-minute rate
   *  does not silently depend on what the default happens to be this month. */
  initialRange?: OpenRange
}) {
  const [live, setLive] = useState(false)
  const [now, setNow] = useState(flooredNow)
  // seeded rather than null: with live off from the start there is nothing to freeze yet, and
  // the reader still has to land on a window. `to` stays open so it reads as "up to now".
  const [frozen, setFrozen] = useState<OpenRange | null>(
    () => initialRange ?? {
      from: new Date(flooredNow() - DEFAULT_WINDOW_MS).toISOString(),
      to: undefined,
    },
  )

  // one interval for the app rather than one per mounted page
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [live])

  const store = useMemo<TimeRangeStore>(
    () => ({
      live,
      frozen,
      now,
      toggleLive: () =>
        setLive((wasLive) => {
          if (wasLive) {
            // pausing keeps the window the reader was looking at, rather than jumping
            setFrozen({
              from: new Date(flooredNow() - DEFAULT_WINDOW_MS).toISOString(),
              to: new Date(flooredNow()).toISOString(),
            })
            return false
          }
          setNow(flooredNow())
          setFrozen(null)
          return true
        }),
      setRange: (next: OpenRange) => {
        setFrozen(next)
        setLive(false)
      },
    }),
    [live, frozen, now],
  )

  return <TimeRangeContext.Provider value={store}>{children}</TimeRangeContext.Provider>
}

function useStore(): TimeRangeStore {
  const store = useContext(TimeRangeContext)
  if (!store) {
    throw new Error('useLiveRange must be used inside a TimeRangeProvider')
  }
  return store
}

/**
 * The shared window exactly as the picker holds it, either end possibly open.
 *
 * Events wants this one: it can search without bounds, and "all time" is a real answer there.
 * Every other page needs a closed window and takes useLiveRange below.
 */
export function useSharedRange(): {
  range: OpenRange
  setRange: (next: OpenRange) => void
} {
  const store = useStore()
  const range = useMemo<OpenRange>(() => {
    if (!store.live) return store.frozen ?? { from: undefined, to: undefined }
    return {
      from: new Date(store.now - DEFAULT_WINDOW_MS).toISOString(),
      to: new Date(store.now).toISOString(),
    }
  }, [store.live, store.frozen, store.now])
  return { range, setRange: store.setRange }
}

/**
 * The shared window, closed at both ends, which is what every stats endpoint requires.
 *
 * An open end is pinned to the tick rather than to `Date.now()`: pinning to the wall clock
 * would put a new value in every query key on every render, and React Query would refetch
 * forever. An open start falls back to the default window for the same reason — a page that
 * has to draw a rate needs two bounds, whatever the picker happens to be showing.
 */
export function useLiveRange(): LiveRange {
  const store = useStore()
  const { range: open, setRange } = useSharedRange()

  const range = useMemo(() => {
    const end = open.to ?? new Date(store.now).toISOString()
    const start = open.from ?? new Date(new Date(end).getTime() - DEFAULT_WINDOW_MS).toISOString()
    return { from: start, to: end }
  }, [open.from, open.to, store.now])

  return { live: store.live, range, toggleLive: store.toggleLive, setRange }
}
