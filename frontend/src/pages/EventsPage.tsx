import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Event, Level } from '../types'
import { buildExportUrl } from '../api/events'
import { useEventSearch } from '../hooks/useEventSearch'
import { useLiveTail } from '../hooks/useLiveTail'
import { useSignals } from '../hooks/useSignals'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { extractHighlightTerms } from '../lib/highlight'
import { combineFilter, quote } from '../lib/filter'
import { matchTraceFilter } from '../lib/trace'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/Button'
import { FilterBar } from '../components/FilterBar'
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
  const [range, setRange] = useState<{ from: string | undefined; to: string | undefined }>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }))
  const [selectedEvent, setSelectedEvent] = useState<Event | undefined>(undefined)
  const [isLive, setIsLive] = useState(false)
  const [isAtTop, setIsAtTop] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
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
  const traceId = useMemo(() => matchTraceFilter(filter), [filter])

  // no filter, no chips/signals (folded into `filter`), no range: an empty result can
  // only mean the server has no events at all -> first-run onboarding (see the spec).
  // Unless everything is archived, which is what the banner below says instead.
  const isUnfiltered = !filter && !range.from && !range.to
  const search = useEventSearch({ filter, from: range.from, to: range.to, pollWhenEmpty: isUnfiltered })
  const tail = useLiveTail({ filter, enabled: isLive, paused: !isAtTop })

  const searchEvents = useMemo(() => search.data?.pages.flatMap((page) => page.events) ?? [], [search.data])

  // live events sit on top of the search page; an id can appear in both after a refetch
  const events = useMemo(() => {
    if (tail.events.length === 0) return searchEvents
    const liveIds = new Set(tail.events.map((event) => event.id))
    return [...tail.events, ...searchEvents.filter((event) => !liveIds.has(event.id))]
  }, [tail.events, searchEvents])

  const liveEventIds = useMemo(() => new Set(tail.events.map((event) => event.id)), [tail.events])

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
  function chooseRange(next: { from: string | undefined; to: string | undefined }) {
    setRange(next)
    setIsLive(false)
  }

  function toggleLive() {
    setIsLive((current) => {
      // live tail always shows "now", so a fixed time range would contradict it
      if (!current) setRange({ from: undefined, to: undefined })
      return !current
    })
  }

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
    <div className="flex h-full min-h-0 flex-col">
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
            onRangeChange={chooseRange}
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

      {search.error && (
        <p className="shrink-0 bg-level-error/10 p-2 text-sm text-level-error">{search.error.message}</p>
      )}
      {tail.error && <p className="shrink-0 bg-level-error/10 p-2 text-sm text-level-error">{tail.error}</p>}

      <ArchivedDaysBanner days={archivedDays} />

      {tail.pendingCount > 0 && (
        <button
          type="button"
          onClick={resume}
          className="shrink-0 bg-accent py-1.5 text-sm font-medium text-accent-fg shadow-[0_0_24px_-4px_var(--color-accent)] transition-colors duration-150 hover:bg-accent-hover"
        >
          {t.events.newEvents(tail.pendingCount)}
        </button>
      )}

      {traceId && <TracePanel traceId={traceId} onSelectEvent={setSelectedEvent} />}

      {/* the stream's own bed: flat and opaque, so a row's colour is its level's and not the
          canvas wash showing through wherever it happens to be scrolled to */}
      <div className="flex min-h-0 flex-1 bg-surface-read">
        <div className="min-w-0 flex-1">
          {search.isLoading ? (
            <div className="animate-pulse space-y-px p-3">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-7 rounded bg-surface-hover" />
              ))}
            </div>
          ) : isUnfiltered && !search.error && events.length === 0 && archivedDays.length === 0 ? (
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
            />
          )}
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
      </div>

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
