import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref, UIEvent } from 'react'
import type { Event } from '../types'
import { useI18n } from '../i18n'
import { EventRow } from './EventRow'
import { Button } from './ui/Button'

const ROW_HEIGHT = 40
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
  ref,
}: VirtualizedEventListProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  useImperativeHandle(ref, () => ({
    scrollToTop: () => containerRef.current?.scrollTo({ top: 0 }),
    ensureVisible: (index: number) => {
      const node = containerRef.current
      if (!node) return
      const top = index * ROW_HEIGHT
      const bottom = top + ROW_HEIGHT
      if (top < node.scrollTop) node.scrollTo({ top })
      else if (bottom > node.scrollTop + node.clientHeight) node.scrollTo({ top: bottom - node.clientHeight })
    },
  }))

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setContainerHeight(entry.contentRect.height))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { startIndex, visibleEvents } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN * 2
    const end = Math.min(events.length, start + visibleCount)
    return { startIndex: start, visibleEvents: events.slice(start, end) }
  }, [events, scrollTop, containerHeight])

  function handleScroll(scrollEvent: UIEvent<HTMLDivElement>) {
    const target = scrollEvent.currentTarget
    setScrollTop(target.scrollTop)
    onAtTopChange(target.scrollTop <= AT_TOP_THRESHOLD)

    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom < LOAD_MORE_THRESHOLD && hasMore && !isLoadingMore) {
      onLoadMore()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {columns.length > 0 && (
        // mirrors EventRow's flex layout so each header sits over its column
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1 text-xs font-medium text-fg-muted">
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
      <div ref={containerRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: events.length * ROW_HEIGHT, position: 'relative' }}>
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
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
            <p>{t.events.noEventsMatch}</p>
            <Button variant="secondary" onClick={onClear}>
              {t.events.clearFilter}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
