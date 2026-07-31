import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Event, SpanRecord } from '../types'
import { useTraceEvents } from '../hooks/useTraceEvents'
import { useTrace } from '../hooks/useTrace'
import { buildTraceLayout, buildSpanWaterfall } from '../lib/trace'
import { ALERT_LEVELS, LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'
import { PageIcon } from './icons'
import { Panel } from './ui/Panel'
import { SeriesChip } from './ui/SeriesChip'
import { SpanTimeline } from './SpanTimeline'
import type { TimelineDot, TimelineRow } from './SpanTimeline'

interface TracePanelProps {
  traceId: string
  onSelectEvent: (event: Event) => void
}

/**
 * One request, laid out end to end.
 *
 * Two modes behind the same waterfall: real OTLP spans when the trace has them (nested, with
 * each span's own duration), and a layout inferred from the logs' timestamps when it does not —
 * there the bounds are the earliest and latest event per span, which is a lower bound on the
 * real duration rather than the thing itself.
 */
export function TracePanel({ traceId, onSelectEvent }: TracePanelProps) {
  const { t, lang } = useI18n()
  const traceEvents = useTraceEvents(traceId)
  const spanQuery = useTrace(traceId)
  const events = useMemo(() => traceEvents.data?.events ?? [], [traceEvents.data])
  const layout = useMemo(() => buildTraceLayout(events), [events])
  const waterfall = useMemo(() => buildSpanWaterfall(spanQuery.data?.spans ?? [], events), [spanQuery.data, events])
  const [selectedSpan, setSelectedSpan] = useState<SpanRecord | null>(null)

  const failures = events.filter((event) => ALERT_LEVELS.includes(event.level) && event.level !== 'Warning').length

  const dotsFor = (list: Event[]): TimelineDot[] =>
    list.map((event) => ({
      key: String(event.id),
      atMs: Date.parse(event.timestamp),
      color: LEVEL_HEX[event.level],
      label: t.trace.dotAria(event.level, event.message),
      // the one thing a reader scanning a trace is looking for is where it went wrong
      lit: ALERT_LEVELS.includes(event.level),
      onClick: () => onSelectEvent(event),
    }))

  const ms = (value: number) => `${Math.round(value).toLocaleString(lang)} ms`

  /**
   * The plate: what this trace is, how long the whole of it took, how many calls it made and
   * how many of them failed — the three numbers somebody opens a trace to find, before they
   * start reading bars.
   */
  function Frame({
    subtitle,
    totalMs,
    spanCount,
    notes,
    children,
  }: {
    subtitle?: string
    totalMs: number
    spanCount: number
    notes?: ReactNode
    children: ReactNode
  }) {
    return (
      <div className="glass shrink-0 border-b border-border bg-surface px-3 pt-3 pb-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent ring-1 ring-accent/20"
              aria-hidden="true"
            >
              <PageIcon name="requests" className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium text-fg">{subtitle ?? t.trace.title}</h2>
              <p className="truncate font-mono text-[0.625rem] text-fg-subtle" title={traceId}>
                {traceId}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <SeriesChip label={t.trace.total} value={ms(totalMs)} />
            <SeriesChip label={t.trace.spans} value={spanCount.toLocaleString(lang)} />
            {failures > 0 && (
              <SeriesChip color={LEVEL_HEX.Error} label={t.trace.failures} value={failures.toLocaleString(lang)} />
            )}
          </div>
        </div>
        {notes}
        {children}
      </div>
    )
  }

  if (waterfall) {
    const rows: TimelineRow[] = waterfall.rows.map((row) => ({
      key: row.span.spanId,
      depth: row.depth,
      labelTitle: `${row.span.name}${row.span.service ? ` — ${row.span.service}` : ''}`,
      onLabelClick: () => setSelectedSpan(row.span),
      label: (
        <>
          {row.span.service && <span className="mr-1 font-mono text-fg-subtle">{row.span.service}</span>}
          {row.span.name}
        </>
      ),
      bar: { startMs: row.startMs, endMs: row.startMs + row.span.durationMs, error: row.span.statusCode === 'error' },
      dots: dotsFor(row.events),
      duration: ms(row.span.durationMs),
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
      <Frame
        subtitle={waterfall.rows[0]?.span.name}
        totalMs={waterfall.endMs - waterfall.startMs}
        spanCount={waterfall.rows.length}
      >
        <SpanTimeline startMs={waterfall.startMs} endMs={waterfall.endMs} rows={rows} />
        {selectedSpan && (
          <Panel className="mt-2 p-3">
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-muted">{t.trace.spanService}</dt>
              <dd className="font-mono text-fg">{selectedSpan.service ?? '—'}</dd>
              <dt className="text-fg-muted">{t.trace.spanKind}</dt>
              <dd className="font-mono text-fg">{selectedSpan.kind}</dd>
              <dt className="text-fg-muted">{t.trace.spanStatus}</dt>
              <dd className={selectedSpan.statusCode === 'error' ? 'font-mono text-level-error' : 'font-mono text-fg'}>
                {`${selectedSpan.statusCode}${selectedSpan.statusMessage ? ` — ${selectedSpan.statusMessage}` : ''}`}
              </dd>
              {selectedSpan.attributes && (
                <>
                  <dt className="text-fg-muted">{t.trace.spanAttributes}</dt>
                  <dd className="overflow-x-auto">
                    <pre className="font-mono text-fg-muted">{selectedSpan.attributes}</pre>
                  </dd>
                </>
              )}
            </dl>
          </Panel>
        )}
      </Frame>
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
        {span.service && <span className="mr-1 font-mono text-fg-subtle">{span.service}</span>}
        {rowLabel(span.spanId, span.label)}
      </>
    ),
    bar: { startMs: span.startMs, endMs: span.endMs, error: span.hasError },
    dots: dotsFor(span.events),
    duration: span.endMs > span.startMs ? ms(span.endMs - span.startMs) : '—',
  }))

  return (
    <Frame
      totalMs={layout.endMs - layout.startMs}
      spanCount={layout.spans.length}
      notes={
        (allSpanless || traceEvents.data?.hasMore) && (
          <div className="mb-2 flex flex-col gap-0.5 text-xs text-fg-muted">
            {allSpanless && <p>{t.trace.noSpanIds}</p>}
            {traceEvents.data?.hasMore && <p>{t.trace.truncated}</p>}
          </div>
        )
      }
    >
      <SpanTimeline startMs={layout.startMs} endMs={layout.endMs} rows={rows} maxHeightClass="max-h-56" />
    </Frame>
  )
}
