import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_PRESET, presetForMinutes, presetMinutes } from '../lib/timeRange'
import type { PresetKey } from '../lib/timeRange'

const REFRESH_MS = 10_000
const DEFAULT_WINDOW_MS = presetMinutes(DEFAULT_PRESET) * 60 * 1000

// floor to the refresh interval so the query keys stay stable within a tick
function flooredNow(): number {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

function iso(at: number): string {
  return new Date(at).toISOString()
}

/** The window as the picker models it: either end may be open. */
export interface OpenRange {
  from: string | undefined
  to: string | undefined
}

/**
 * A window that follows now, or two ends that hold still.
 *
 * Rolling carries its preset so every page can name it the same way ("Last 6 hours"); a width
 * brushed out of a chart has no preset and gets named by its two ends instead.
 */
type ChosenWindow =
  | { kind: 'rolling'; minutes: number; preset: PresetKey | null }
  | { kind: 'fixed'; from: string | undefined; to: string | undefined }

export interface LiveRange {
  live: boolean
  /** Always a closed window: rate and percentile maths cannot work with an open end. */
  range: { from: string; to: string }
  /** Set while the window follows now, so the picker can name it rather than print two dates. */
  presetKey: PresetKey | null
  toggleLive: () => void
  /** Picking two ends by hand leaves live mode — a window that is not "now" contradicts it. */
  setRange: (next: OpenRange) => void
  /** A preset keeps rolling, so it does not leave live mode: it *is* "now", only wider. */
  setPreset: (key: PresetKey) => void
}

interface TimeRangeStore {
  live: boolean
  chosen: ChosenWindow
  now: number
  toggleLive: () => void
  setRange: (next: OpenRange) => void
  setPreset: (key: PresetKey) => void
}

const TimeRangeContext = createContext<TimeRangeStore | null>(null)

const DEFAULT_WINDOW: ChosenWindow = {
  kind: 'rolling',
  minutes: presetMinutes(DEFAULT_PRESET),
  preset: DEFAULT_PRESET,
}

/** Pausing holds what was on screen, which means a rolling window has to be pinned down. */
function freeze(chosen: ChosenWindow): ChosenWindow {
  if (chosen.kind === 'fixed') return chosen
  const end = flooredNow()
  return { kind: 'fixed', from: iso(end - chosen.minutes * 60_000), to: iso(end) }
}

/** Resuming rolls again, at the width the reader was paused on rather than back at an hour. */
function roll(chosen: ChosenWindow): ChosenWindow {
  if (chosen.kind === 'rolling') return chosen
  if (!chosen.from || !chosen.to) return DEFAULT_WINDOW // an open end has no width to keep
  const minutes = Math.round(
    (new Date(chosen.to).getTime() - new Date(chosen.from).getTime()) / 60_000,
  )
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_WINDOW
  return { kind: 'rolling', minutes, preset: presetForMinutes(minutes) }
}

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
 * It opens on a rolling last hour, live: a log viewer that has to be switched on before it
 * shows anything moving reads as broken on the first screen, and a reload put every reader
 * back there. On Events that flag also opens a socket, which is what a reader who has just
 * opened a log viewer came for.
 *
 * Rolling and live stay two things, though. Rolling is a property of the window (it follows
 * now); live is a property of the reading (the tail streams, the window is allowed to move).
 * They came apart because tying them together made paused mean frozen, so a window that had
 * never been picked still pinned itself the moment the reader pressed pause. Now only an
 * actual pause freezes, and it freezes what was on screen. An initialRange is the one opening
 * that is already a pick, so it opens paused on those two ends.
 *
 * A preset is a rolling window, not two dates recorded when it was clicked, so "Last 6 hours"
 * still means the last six hours ten minutes later — and every page can print that name, which
 * is what "keep my choice between pages" looks like to the reader. Two ends chosen by hand (or
 * brushed out of a chart) hold still, and those do leave live mode.
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
  // an initialRange is a pick, and a pick contradicts "now", so it opens paused
  const [live, setLive] = useState(!initialRange)
  const [now, setNow] = useState(flooredNow)
  const [chosen, setChosen] = useState<ChosenWindow>(() =>
    initialRange ? { kind: 'fixed', ...initialRange } : DEFAULT_WINDOW,
  )

  // one interval for the app rather than one per mounted page. It runs while the window rolls,
  // which is a property of the window — live only decides whether the tail streams into it.
  useEffect(() => {
    if (chosen.kind !== 'rolling') return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [chosen.kind])

  const store = useMemo<TimeRangeStore>(
    () => ({
      live,
      chosen,
      now,
      toggleLive: () => {
        setChosen(live ? freeze(chosen) : roll(chosen))
        if (!live) setNow(flooredNow())
        setLive(!live)
      },
      setRange: (next: OpenRange) => {
        setChosen({ kind: 'fixed', ...next })
        setLive(false)
      },
      setPreset: (key: PresetKey) => {
        setChosen({ kind: 'rolling', minutes: presetMinutes(key), preset: key })
      },
    }),
    [live, chosen, now],
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
  setPreset: (key: PresetKey) => void
  presetKey: PresetKey | null
  live: boolean
  toggleLive: () => void
} {
  const store = useStore()
  const range = useMemo<OpenRange>(() => {
    if (store.chosen.kind === 'fixed') return { from: store.chosen.from, to: store.chosen.to }
    return { from: iso(store.now - store.chosen.minutes * 60_000), to: iso(store.now) }
  }, [store.chosen, store.now])
  return {
    range,
    setRange: store.setRange,
    setPreset: store.setPreset,
    presetKey: store.chosen.kind === 'rolling' ? store.chosen.preset : null,
    live: store.live,
    toggleLive: store.toggleLive,
  }
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
  const { range: open, setRange, setPreset, presetKey } = useSharedRange()

  const range = useMemo(() => {
    const end = open.to ?? iso(store.now)
    const start = open.from ?? iso(new Date(end).getTime() - DEFAULT_WINDOW_MS)
    return { from: start, to: end }
  }, [open.from, open.to, store.now])

  return { live: store.live, range, presetKey, toggleLive: store.toggleLive, setRange, setPreset }
}
