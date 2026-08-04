import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Event, Level } from '../types'
import { buildExportUrl } from '../api/events'
import { useEventSearch } from '../hooks/useEventSearch'
import { useHistogram } from '../hooks/useStats'
import { useLiveTail } from '../hooks/useLiveTail'
import { useSharedRange } from '../hooks/useLiveRange'
import { useHealth } from '../hooks/useHealth'
import { sumLevels } from '../lib/levels'
import { useSignals } from '../hooks/useSignals'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { extractHighlightTerms } from '../lib/highlight'
import { combineFilter, quote } from '../lib/filter'
import { matchTraceFilter } from '../lib/trace'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/Button'
import { FilterBar } from '../components/FilterBar'
import { Histogram } from '../components/Histogram'
import { Panel } from '../components/ui/Panel'
import { LevelChips } from '../components/LevelChips'
import { SignalToggles } from '../components/SignalToggles'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { ColumnPicker } from '../components/ColumnPicker'
import { VirtualizedEventList } from '../components/VirtualizedEventList'
import type { EventListHandle } from '../components/VirtualizedEventList'
import { EventDetail } from '../components/EventDetail'
import { OnboardingPanel } from '../components/OnboardingPanel'
import { TracePanel } from '../components/TracePanel'
import { ArchivedDaysBanner } from '../components/ArchivedDaysBanner'

/** Wide enough to read the shape of a day, narrow enough that each column is still a tick. */
const CHART_BUCKETS = 80
const CHART_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The window the chart covers when the reader has not picked one.
 *
 * The last 24 hours, except on an instance whose newest matching event is older than that —
 * there the 24 hours are taken to end at that event instead. Otherwise a server that stopped
 * receiving on Friday draws an empty chart over a full list, which reads as a broken chart
 * rather than as an idle server.
 */
function defaultChartEnd(newestMatch: string | undefined, nowMinute: number): number {
  if (!newestMatch) return nowMinute
  const at = new Date(newestMatch).getTime()
  return Number.isFinite(at) && at < nowMinute - CHART_WINDOW_MS ? at : nowMinute
}

// shortcuts must not fire while the user is typing into a field
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  )
}

export function EventsPage() {
  const { t } = useI18n()
  // reads dashboard/analysis deep links (?from=&to=&filter=) once, on first mount only
  const [searchParams] = useSearchParams()
  const initialFilter = searchParams.get('filter') ?? ''
  const [searchText, setSearchText] = useState(initialFilter)
  // FilterBar seeds its chip state from initialText once; bumping the key remounts it
  // so a programmatic filter (View trace) shows up in the bar as well as the results
  const [filterSeed, setFilterSeed] = useState(0)
  const [activeLevels, setActiveLevels] = useState<Set<Level>>(new Set())
  const [activeSignalIds, setActiveSignalIds] = useState<Set<number>>(new Set())
  // The app's one window and its one live flag — see hooks/useLiveRange. Live means the same
  // thing here as everywhere else: the window rolls, and on this page the tail streams into it
  // as well. Events kept a private flag for a while and it made the button in the corner mean
  // two different things depending on which page you were on.
  const { range, setRange, setPreset, presetKey, live: isLive, toggleLive } = useSharedRange()
  const [selectedEvent, setSelectedEvent] = useState<Event | undefined>(undefined)
  const [isAtTop, setIsAtTop] = useState(true)
  const [showHelp, setShowHelp] = useState(false)

  // ?from=&to= from a dashboard or analysis deep link sets the shared window, once
  const deepFrom = searchParams.get('from')
  const deepTo = searchParams.get('to')
  useEffect(() => {
    if (deepFrom || deepTo) setRange({ from: deepFrom ?? undefined, to: deepTo ?? undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [columns, setColumns] = useLocalStorage<string[]>('logharbor.columns', [])
  const [relativeTime, setRelativeTime] = useLocalStorage<boolean>('logharbor.relativeTime', false)

  // relative timestamps drift; re-render every 30s so "2 min ago" stays honest
  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!relativeTime) return
    const handle = setInterval(() => setNowTick((tick) => tick + 1), 30_000)
    return () => clearInterval(handle)
  }, [relativeTime])

  const listRef = useRef<EventListHandle>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const { data: signals } = useSignals()

  const activeSignalFilters = useMemo(
    () => (signals ?? []).filter((signal) => activeSignalIds.has(signal.id)).map((signal) => signal.filter),
    [signals, activeSignalIds],
  )
  const filter = useMemo(
    () => combineFilter(searchText, activeLevels, activeSignalFilters),
    [searchText, activeLevels, activeSignalFilters],
  )
  const highlightTerms = useMemo(() => extractHighlightTerms(searchText), [searchText])
  // matched against the search text, not `filter`: level chips and signals are AND-ed into
  // the combined string, and either of them used to make "View trace" draw nothing at all
  const traceId = useMemo(() => matchTraceFilter(searchText), [searchText])

  // no filter, no chips/signals (folded into `filter`), no range: an empty result can
  // only mean the server has no events at all -> first-run onboarding (see the spec).
  // Unless everything is archived, which is what the banner below says instead.
  //
  // "No events at all" used to be inferred from an unbounded search, which worked only while
  // this page opened on all time. It opens on the shared window now, so the question is asked
  // directly: /healthz counts the whole database, and zero there is the actual first run.
  const health = useHealth()
  const isFirstRun = health.data?.eventCount === 0
  const search = useEventSearch({ filter, from: range.from, to: range.to, pollWhenEmpty: isFirstRun })
  const tail = useLiveTail({ filter, enabled: isLive, paused: !isAtTop })

  const searchEvents = useMemo(() => search.data?.pages.flatMap((page) => page.events) ?? [], [search.data])

  // live events sit on top of the search page; an id can appear in both after a refetch
  const events = useMemo(() => {
    if (tail.events.length === 0) return searchEvents
    const liveIds = new Set(tail.events.map((event) => event.id))
    return [...tail.events, ...searchEvents.filter((event) => !liveIds.has(event.id))]
  }, [tail.events, searchEvents])

  const liveEventIds = useMemo(() => new Set(tail.events.map((event) => event.id)), [tail.events])

  // The stream says what happened; the chart says when. It carries the page's own filter, so
  // narrowing the search reshapes it — which is the whole reason it belongs here rather than
  // being a second copy of the dashboard's.
  // Anchored on the search results, not the live tail: in live mode the tail prepends an event
  // every few seconds and the window would slide out from under anyone reading it.
  const newestMatch = searchEvents[0]?.timestamp
  const chartRange = useMemo(() => {
    // to the minute, so the query key is stable between ticks instead of refetching per render
    const nowMinute = Math.floor(Date.now() / 60_000) * 60_000
    const end = range.to ? new Date(range.to).getTime() : defaultChartEnd(newestMatch, nowMinute)
    const start = range.from ? new Date(range.from).getTime() : end - CHART_WINDOW_MS
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
  }, [range.from, range.to, newestMatch])

  const chart = useHistogram({ ...chartRange, filter, buckets: CHART_BUCKETS })
  const chartBuckets = chart.data?.buckets ?? []
  // an empty plot is a 160px hole that teaches nothing; the page keeps its full height instead
  const hasChart = chartBuckets.some((bucket) => sumLevels(bucket.counts) > 0)

  // every page of one range reports the same cold days, so the first page is enough
  const archivedDays = search.data?.pages[0]?.archivedDays ?? []

  function applyFilter(next: string) {
    setSearchText(next)
    setFilterSeed((seed) => seed + 1)
  }

  function toggleLevel(level: Level) {
    setActiveLevels((current) => {
      const next = new Set(current)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  function toggleSignal(id: number) {
    setActiveSignalIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // an explicit window and a live tail contradict each other, so picking one leaves the other
  // setRange already drops out of live — an explicit window contradicts "now" — so the tail
  // stops with it rather than streaming events the chosen window would not have matched
  const chooseRange = setRange

  function resume() {
    tail.flush()
    listRef.current?.scrollToTop()
    setIsAtTop(true)
  }

  const moveSelection = useCallback(
    (delta: number) => {
      if (events.length === 0) return
      const currentIndex = selectedEvent ? events.findIndex((item) => item.id === selectedEvent.id) : -1
      const nextIndex =
        currentIndex === -1 ? 0 : Math.min(events.length - 1, Math.max(0, currentIndex + delta))
      setSelectedEvent(events[nextIndex])
      listRef.current?.ensureVisible(nextIndex)
    },
    [events, selectedEvent],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      if (event.key === '/') {
        event.preventDefault()
        document.getElementById('event-search')?.focus()
      } else if (event.key === 'j' || event.key === 'k') {
        moveSelection(event.key === 'j' ? 1 : -1)
      } else if (event.key === 'Escape') {
        if (showHelp) setShowHelp(false)
        else setSelectedEvent(undefined)
      } else if (event.key === '?') {
        setShowHelp((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [moveSelection, showHelp])

  const shortcuts: [key: string, action: string][] = [
    ['/', t.events.shortcutFocusSearch],
    ['j / k', t.events.shortcutNextPrev],
    ['Esc', t.events.shortcutCloseDetail],
    ['?', t.events.shortcutToggleHelp],
  ]

  return (
    // one scrollbar for the page: the filter bar and the chart scroll away with the stream
    // rather than holding their own bands while only the rows move. The drawer sits outside
    // that scroller, so it stays put over the full height of the page.
    <div className="relative h-full">
    <div ref={pageRef} className="flex h-full flex-col overflow-y-auto">
      <div className="glass shrink-0 border-b border-border bg-surface shadow-card">
        <div className="flex items-start gap-3 p-3">
          <div className="min-w-0 flex-1">
            <FilterBar key={filterSeed} initialText={searchText} onCommit={setSearchText} />
          </div>
          {/* top right, the same corner as every other page — this row is the page's header */}
          <LiveRangeControls
            live={isLive}
            onToggleLive={toggleLive}
            from={range.from}
            to={range.to}
            presetKey={presetKey}
            onRangeChange={chooseRange}
            onPreset={setPreset}
            status={tail.status}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <LevelChips activeLevels={activeLevels} onToggle={toggleLevel} />
            <SignalToggles activeSignalIds={activeSignalIds} onToggle={toggleSignal} />
          </div>
          <div className="flex items-center gap-2">
            <ColumnPicker columns={columns} onChange={setColumns} />
            <Button variant="ghost" onClick={() => setRelativeTime((current) => !current)} title={t.events.toggleTimestamps}>
              {relativeTime ? t.events.relativeTime : t.events.absoluteTime}
            </Button>
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              {t.events.export}
              <a
                href={buildExportUrl({ filter, from: range.from, to: range.to, format: 'json' })}
                className="rounded-lg px-2 py-1 font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
              >
                JSON
              </a>
              <a
                href={buildExportUrl({ filter, from: range.from, to: range.to, format: 'csv' })}
                className="rounded-lg px-2 py-1 font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
              >
                CSV
              </a>
            </span>
          </div>
        </div>
      </div>

      {/* The level chips directly above are already the chart's colour key, so it carries no
          legend of its own. Clicking a bar narrows the range to it, dragging across bars zooms
          — the same two gestures the dashboard's timeline answers to. */}
      {hasChart && (
        <div className="shrink-0 px-3 pt-3">
          <Panel className={`p-4 ${chart.isFetching ? 'opacity-60 transition-opacity' : ''}`}>
            <Histogram
              buckets={chartBuckets}
              rangeEnd={chartRange.to}
              onBucketClick={(from, to) => chooseRange({ from, to })}
              onBrush={(from, to) => chooseRange({ from, to })}
              showLegend={false}
            />
          </Panel>
        </div>
      )}

      {search.error && (
        <p className="shrink-0 bg-level-error/10 p-2 text-sm text-level-error">{search.error.message}</p>
      )}
      {tail.error && <p className="shrink-0 bg-level-error/10 p-2 text-sm text-level-error">{tail.error}</p>}

      <ArchivedDaysBanner days={archivedDays} />

      {tail.pendingCount > 0 && (
        <button
          type="button"
          onClick={resume}
          className="sticky top-0 z-20 shrink-0 bg-accent py-1.5 text-sm font-medium text-accent-fg shadow-[0_0_24px_-4px_var(--color-accent)] transition-colors duration-150 hover:bg-accent-hover"
        >
          {t.events.newEvents(tail.pendingCount)}
        </button>
      )}

      {traceId && <TracePanel traceId={traceId} onSelectEvent={setSelectedEvent} />}

      {/* the stream's own bed: flat and opaque, so a row's colour is its level's and not the
          canvas wash showing through wherever it happens to be scrolled to */}
      <div className={`flex flex-1 bg-surface-read ${selectedEvent ? 'pr-[28rem]' : ''}`}>
        <div className="flex min-w-0 flex-1 flex-col">
          {search.isLoading ? (
            <div className="animate-pulse space-y-px p-3">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-7 rounded bg-surface-hover" />
              ))}
            </div>
          ) : isFirstRun && !filter && !search.error && events.length === 0 && archivedDays.length === 0 ? (
            <OnboardingPanel />
          ) : (
            <VirtualizedEventList
              ref={listRef}
              events={events}
              highlightTerms={highlightTerms}
              columns={columns}
              relativeTime={relativeTime}
              liveEventIds={liveEventIds}
              selectedEventId={selectedEvent?.id}
              onSelect={setSelectedEvent}
              hasMore={search.hasNextPage}
              isLoadingMore={search.isFetchingNextPage}
              onLoadMore={() => search.fetchNextPage()}
              onAtTopChange={setIsAtTop}
              onClear={() => setSearchText('')}
              scrollRef={pageRef}
            />
          )}
        </div>
      </div>
    </div>

      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          highlightTerms={highlightTerms}
          onClose={() => setSelectedEvent(undefined)}
          onViewTrace={(traceId) => applyFilter(`@TraceId = ${quote(traceId)}`)}
          onFilter={applyFilter}
          onLookAround={(from, to) => setRange({ from, to })}
        />
      )}

      {showHelp && (
        <div className="fixed inset-0 z-20 flex items-center justify-center">
          {/* a real button so closing works with the keyboard too; Escape is handled globally */}
          <button
            type="button"
            aria-label={t.events.closeShortcuts}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => setShowHelp(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.events.keyboardShortcuts}
            className="glass animate-rise relative w-72 rounded-card border border-border bg-surface p-4 text-sm shadow-pop"
          >
            <h2 className="mb-3 font-semibold text-fg">{t.events.keyboardShortcuts}</h2>
            {shortcuts.map(([key, action]) => (
              <div key={key} className="flex items-center justify-between py-1">
                <kbd className="rounded border border-border bg-surface-inset px-1.5 py-0.5 font-mono text-xs">
                  {key}
                </kbd>
                <span className="text-fg-muted">{action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
