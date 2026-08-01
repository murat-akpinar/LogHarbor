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
  /** The window the reader chose, or froze by pausing. Null means the rolling default. */
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
 * default rather than resuming a window from whoever was here before. Asked for on 2026-08-01
 * in exactly those words — whoever has not set anything gets the last hour, every time.
 *
 * It opens on a rolling last hour with live *off*: nobody asked for a stream on sign-in, and
 * on Events that flag also opens a socket. Two things had to come apart for that to be safe.
 * Rolling is a property of the window (nothing picked yet, so it follows now); live is a
 * property of the reading (the tail streams, the clock is allowed to move). Tying them
 * together is what forced live-on as the default: paused used to mean frozen, so opening
 * paused froze the window at the moment of sign-in and a tab left open over lunch showed the
 * hour before it with nothing on the page to say so. Now only an actual pause freezes, and it
 * freezes what was on screen — there is nothing to hold on to before the reader touches it.
 *
 * Choosing a range explicitly still leaves live, because an explicit window contradicts "now",
 * and that choice is what follows you between pages.
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
  // the reader turns the stream on themselves; an initialRange is a pick, so it never rolls
  const [live, setLive] = useState(false)
  const [now, setNow] = useState(flooredNow)
  // null until something is picked or paused; toggleLive fills it with whatever was on screen
  const [frozen, setFrozen] = useState<OpenRange | null>(initialRange ?? null)

  // one interval for the app rather than one per mounted page. It runs while the window rolls,
  // which is exactly "nothing picked" — live only decides whether the tail streams into it.
  useEffect(() => {
    if (frozen !== null) return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [frozen])

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
  live: boolean
  toggleLive: () => void
} {
  const store = useStore()
  const range = useMemo<OpenRange>(() => {
    // a pick wins even when both its ends are open — that is the picker's "clear", i.e. all time
    if (store.frozen !== null) return store.frozen
    return {
      from: new Date(store.now - DEFAULT_WINDOW_MS).toISOString(),
      to: new Date(store.now).toISOString(),
    }
  }, [store.frozen, store.now])
  return { range, setRange: store.setRange, live: store.live, toggleLive: store.toggleLive }
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
