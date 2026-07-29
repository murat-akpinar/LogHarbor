import { useMemo, useState } from 'react'
import type { Event, SpanRecord } from '../types'
import { useTraceEvents } from '../hooks/useTraceEvents'
import { useTrace } from '../hooks/useTrace'
import { buildTraceLayout, buildSpanWaterfall } from '../lib/trace'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'
import { SpanTimeline } from './SpanTimeline'
import type { TimelineDot, TimelineRow } from './SpanTimeline'

interface TracePanelProps {
  traceId: string
  onSelectEvent: (event: Event) => void
}

/** Span waterfall inferred from the trace's log timestamps — bounds are the
 * earliest/latest event per span, a lower bound on the real span duration. */
export function TracePanel({ traceId, onSelectEvent }: TracePanelProps) {
  const { t, lang } = useI18n()
  const traceEvents = useTraceEvents(traceId)
  const spanQuery = useTrace(traceId)
  const layout = useMemo(() => buildTraceLayout(traceEvents.data?.events ?? []), [traceEvents.data])
  const waterfall = useMemo(
    () => buildSpanWaterfall(spanQuery.data?.spans ?? [], traceEvents.data?.events ?? []),
    [spanQuery.data, traceEvents.data],
  )
  const [selectedSpan, setSelectedSpan] = useState<SpanRecord | null>(null)

  const dotsFor = (events: Event[]): TimelineDot[] =>
    events.map((event) => ({
      key: String(event.id),
      atMs: Date.parse(event.timestamp),
      color: LEVEL_HEX[event.level],
      label: t.trace.dotAria(event.level, event.message),
      onClick: () => onSelectEvent(event),
    }))

  const header = (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="text-sm font-semibold text-fg">{t.trace.title}</h2>
      <span className="truncate font-mono text-xs text-fg-muted" title={traceId}>
        {traceId}
      </span>
    </div>
  )

  if (waterfall) {
    const rows: TimelineRow[] = waterfall.rows.map((row) => ({
      key: row.span.spanId,
      depth: row.depth,
      labelTitle: `${row.span.name}${row.span.service ? ` — ${row.span.service}` : ''}`,
      onLabelClick: () => setSelectedSpan(row.span),
      label: (
        <>
          {row.span.service && <span className="mr-1 font-mono text-fg-muted">{row.span.service}</span>}
          {row.span.name}
        </>
      ),
      bar: { startMs: row.startMs, endMs: row.startMs + row.span.durationMs, error: row.span.statusCode === 'error' },
      dots: dotsFor(row.events),
      duration: `${Math.round(row.span.durationMs).toLocaleString(lang)} ms`,
    }))

    if (waterfall.orphanEvents.length > 0) {
      rows.push({
        key: 'orphans',
        label: t.trace.noSpan,
        bar: null,
        dots: dotsFor(waterfall.orphanEvents),
        duration: '',
      })
    }

    return (
      <div className="shrink-0 border-b border-border bg-surface p-3">
        {header}
        <SpanTimeline startMs={waterfall.startMs} endMs={waterfall.endMs} rows={rows} />
        {selectedSpan && (
          <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5 border-t border-border pt-2 text-xs">
            <dt className="text-fg-muted">{t.trace.spanService}</dt><dd className="text-fg">{selectedSpan.service ?? '—'}</dd>
            <dt className="text-fg-muted">{t.trace.spanKind}</dt><dd className="text-fg">{selectedSpan.kind}</dd>
            <dt className="text-fg-muted">{t.trace.spanStatus}</dt>
            <dd className={selectedSpan.statusCode === 'error' ? 'text-level-error' : 'text-fg'}>
              {`${selectedSpan.statusCode}${selectedSpan.statusMessage ? ` — ${selectedSpan.statusMessage}` : ''}`}
            </dd>
            {selectedSpan.attributes && (
              <>
                <dt className="text-fg-muted">{t.trace.spanAttributes}</dt>
                <dd className="overflow-x-auto"><pre className="font-mono text-fg-muted">{selectedSpan.attributes}</pre></dd>
              </>
            )}
          </dl>
        )}
      </div>
    )
  }

  if (!layout) return null

  const allSpanless = layout.spans.every((span) => span.spanId === null)

  // when the whole trace is spanless the noSpanIds message already explains the
  // single row, so the "(no span)" label would be noise
  const rowLabel = (spanId: string | null, label: string) =>
    spanId === null ? (allSpanless ? '' : t.trace.noSpan) : label

  const rows: TimelineRow[] = layout.spans.map((span) => ({
    key: span.spanId ?? 'no-span',
    labelTitle: span.spanId ? `${span.label} — ${span.spanId}` : rowLabel(span.spanId, span.label),
    label: (
      <>
        {span.service && <span className="mr-1 font-mono text-fg-muted">{span.service}</span>}
        {rowLabel(span.spanId, span.label)}
      </>
    ),
    bar: { startMs: span.startMs, endMs: span.endMs, error: span.hasError },
    dots: dotsFor(span.events),
    duration: span.endMs > span.startMs ? `${Math.round(span.endMs - span.startMs).toLocaleString(lang)} ms` : '—',
  }))

  return (
    <div className="shrink-0 border-b border-border bg-surface p-3">
      {header}

      {allSpanless && <p className="mb-2 text-xs text-fg-muted">{t.trace.noSpanIds}</p>}
      {traceEvents.data?.hasMore && <p className="mb-2 text-xs text-fg-muted">{t.trace.truncated}</p>}

      <SpanTimeline startMs={layout.startMs} endMs={layout.endMs} rows={rows} maxHeightClass="max-h-56" />
    </div>
  )
}
