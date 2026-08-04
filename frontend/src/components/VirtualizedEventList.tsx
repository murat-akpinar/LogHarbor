import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref, RefObject } from 'react'
import type { Event } from '../types'
import { useI18n } from '../i18n'
import { EventRow } from './EventRow'
import { Button } from './ui/Button'

// a log stream is read by scanning it, and 40px spent a quarter of every screen on air
const ROW_HEIGHT = 32
const OVERSCAN = 8
// how close to the bottom (in px) triggers the next page fetch
const LOAD_MORE_THRESHOLD = 200
// scrolled within this many px of the top still counts as "at the top"
const AT_TOP_THRESHOLD = 8

export interface EventListHandle {
  scrollToTop: () => void
  /** Scrolls just enough to bring the row at index into view (keyboard navigation). */
  ensureVisible: (index: number) => void
}

interface VirtualizedEventListProps {
  events: Event[]
  highlightTerms: string[]
  columns: string[]
  relativeTime: boolean
  liveEventIds: ReadonlySet<number>
  selectedEventId: number | undefined
  onSelect: (event: Event) => void
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  onAtTopChange: (atTop: boolean) => void
  onClear: () => void
  /** The page's scroll container: the list draws its window from that one scrollbar. */
  scrollRef: RefObject<HTMLElement | null>
  ref?: Ref<EventListHandle>
}

export function VirtualizedEventList({
  events,
  highlightTerms,
  columns,
  relativeTime,
  liveEventIds,
  selectedEventId,
  onSelect,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onAtTopChange,
  onClear,
  scrollRef,
  ref,
}: VirtualizedEventListProps) {
  const { t } = useI18n()
  const rowsRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ scrolledPast: 0, height: 0 })

  // read inside a listener that is attached once, so a fresh onLoadMore per render does not
  // mean detaching and reattaching the page's scroll handler on every render
  const handlers = useRef({ hasMore, isLoadingMore, onLoadMore, onAtTopChange })
  handlers.current = { hasMore, isLoadingMore, onLoadMore, onAtTopChange }

  useImperativeHandle(ref, () => ({
    scrollToTop: () => scrollRef.current?.scrollTo({ top: 0 }),
    ensureVisible: (index: number) => {
      const scroller = scrollRef.current
      const rows = rowsRef.current
      if (!scroller || !rows) return
      const listTop =
        rows.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const top = listTop + index * ROW_HEIGHT
      const bottom = top + ROW_HEIGHT
      if (top < scroller.scrollTop) scroller.scrollTo({ top })
      else if (bottom > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTo({ top: bottom - scroller.clientHeight })
      }
    },
  }))

  // Scrolling is not the only way the window moves: the header above the rows grows and shrinks
  // (a chart appearing, a banner, chips wrapping onto a second line), and a shorter list can
  // leave the page unscrollable with the tail still paused and no scrollbar left to un-pause it.
  // Both ends are watched, so the same measurement answers every case.
  useEffect(() => {
    const scroller = scrollRef.current
    const rows = rowsRef.current
    if (!scroller || !rows) return

    const measure = () => {
      setView({
        scrolledPast: Math.max(
          0,
          scroller.getBoundingClientRect().top - rows.getBoundingClientRect().top,
        ),
        height: scroller.clientHeight,
      })
      const { hasMore, isLoadingMore, onLoadMore, onAtTopChange } = handlers.current
      onAtTopChange(scroller.scrollTop <= AT_TOP_THRESHOLD)
      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      if (distanceToBottom < LOAD_MORE_THRESHOLD && hasMore && !isLoadingMore) onLoadMore()
    }

    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    observer.observe(rows)
    return () => {
      scroller.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [scrollRef])

  const { startIndex, visibleEvents } = useMemo(() => {
    const start = Math.max(0, Math.floor(view.scrolledPast / ROW_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(view.height / ROW_HEIGHT) + OVERSCAN * 2
    const end = Math.min(events.length, start + visibleCount)
    return { startIndex: start, visibleEvents: events.slice(start, end) }
  }, [events, view])

  return (
    <div className="flex flex-1 flex-col">
      {columns.length > 0 && (
        // mirrors EventRow's flex layout so each header sits over its column, and sticks to the
        // top of the page once the filter bar above it has scrolled away
        <div className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-border bg-surface-read px-3 py-1 text-xs font-medium text-fg-muted">
          <span className={`${relativeTime ? 'w-24' : 'w-44'} shrink-0`}>{t.events.timeHeader}</span>
          <span className="w-10 shrink-0">{t.events.levelHeader}</span>
          {columns.map((column) => (
            <span key={column} className="w-32 shrink-0 truncate font-mono">
              {column}
            </span>
          ))}
          <span className="min-w-0 flex-1">{t.events.messageHeader}</span>
        </div>
      )}
      <div ref={rowsRef} style={{ height: events.length * ROW_HEIGHT, position: 'relative' }}>
        {visibleEvents.map((event, offset) => (
          <EventRow
            key={event.id}
            event={event}
            highlightTerms={highlightTerms}
            columns={columns}
            relativeTime={relativeTime}
            isNew={liveEventIds.has(event.id)}
            isSelected={event.id === selectedEventId}
            onSelect={onSelect}
            style={{ top: (startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
          />
        ))}
      </div>
      {events.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-sm text-fg-muted">
          <p>{t.events.noEventsMatch}</p>
          <Button variant="secondary" onClick={onClear}>
            {t.events.clearFilter}
          </Button>
        </div>
      )}
    </div>
  )
}
