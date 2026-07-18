import { useMemo, useState } from 'react'
import type { Event, SpanRecord } from '../types'
import { useTraceEvents } from '../hooks/useTraceEvents'
import { useTrace } from '../hooks/useTrace'
import { buildTraceLayout, buildSpanWaterfall } from '../lib/trace'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

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

  function renderWaterfall() {
    const totalMs = Math.max(1, waterfall!.endMs - waterfall!.startMs)
    const percent = (ms: number) => `${((ms - waterfall!.startMs) / totalMs) * 100}%`
    return (
      <div className="shrink-0 border-b border-border bg-surface p-3">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-fg">{t.trace.title}</h2>
          <span className="truncate font-mono text-xs text-fg-muted" title={traceId}>{traceId}</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {waterfall!.rows.map((row) => (
            <div key={row.span.spanId} className="grid grid-cols-[minmax(10rem,20rem)_1fr_5rem] items-center gap-2 py-0.5">
              <button
                type="button"
                onClick={() => setSelectedSpan(row.span)}
                className="truncate text-left text-xs text-fg hover:text-accent"
                style={{ paddingLeft: `${row.depth * 12}px` }}
                title={`${row.span.name}${row.span.service ? ` — ${row.span.service}` : ''}`}
              >
                {row.span.service && <span className="mr-1 font-mono text-fg-muted">{row.span.service}</span>}
                {row.span.name}
              </button>
              <div className="relative h-4">
                <div
                  aria-hidden="true"
                  className="absolute top-1 h-2 rounded-sm opacity-40"
                  style={{
                    left: percent(row.startMs),
                    width: `${(row.span.durationMs / totalMs) * 100}%`,
                    backgroundColor: row.span.statusCode === 'error' ? LEVEL_HEX.Error : LEVEL_HEX.Information,
                  }}
                />
                {row.events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    aria-label={t.trace.dotAria(event.level, event.message)}
                    title={t.trace.dotAria(event.level, event.message)}
                    onClick={() => onSelectEvent(event)}
                    className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full border border-bg"
                    style={{ left: percent(Date.parse(event.timestamp)), backgroundColor: LEVEL_HEX[event.level] }}
                  />
                ))}
              </div>
              <span className="tabular text-right text-xs text-fg-muted">
                {`${Math.round(row.span.durationMs).toLocaleString(lang)} ms`}
              </span>
            </div>
          ))}
          {waterfall!.orphanEvents.length > 0 && (
            <div className="grid grid-cols-[minmax(10rem,20rem)_1fr_5rem] items-center gap-2 py-0.5">
              <span className="truncate text-xs text-fg-muted">{t.trace.noSpan}</span>
              <div className="relative h-4">
                {waterfall!.orphanEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    aria-label={t.trace.dotAria(event.level, event.message)}
                    title={t.trace.dotAria(event.level, event.message)}
                    onClick={() => onSelectEvent(event)}
                    className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full border border-bg"
                    style={{ left: percent(Date.parse(event.timestamp)), backgroundColor: LEVEL_HEX[event.level] }}
                  />
                ))}
              </div>
              <span />
            </div>
          )}
        </div>
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

  if (waterfall) {
    return renderWaterfall()
  }
  if (!layout) return null

  const totalMs = Math.max(1, layout.endMs - layout.startMs)
  const percent = (ms: number) => `${((ms - layout.startMs) / totalMs) * 100}%`
  const allSpanless = layout.spans.every((span) => span.spanId === null)

  // when the whole trace is spanless the noSpanIds message already explains the
  // single row, so the "(no span)" label would be noise
  const rowLabel = (spanId: string | null, label: string) =>
    spanId === null ? (allSpanless ? '' : t.trace.noSpan) : label

  return (
    <div className="shrink-0 border-b border-border bg-surface p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-fg">{t.trace.title}</h2>
        <span className="truncate font-mono text-xs text-fg-muted" title={traceId}>
          {traceId}
        </span>
      </div>

      {allSpanless && <p className="mb-2 text-xs text-fg-muted">{t.trace.noSpanIds}</p>}
      {traceEvents.data?.hasMore && <p className="mb-2 text-xs text-fg-muted">{t.trace.truncated}</p>}

      <div className="max-h-56 overflow-y-auto">
        {layout.spans.map((span) => (
          <div
            key={span.spanId ?? 'no-span'}
            className="grid grid-cols-[minmax(8rem,16rem)_1fr_5rem] items-center gap-2 py-0.5"
          >
            <span
              className="truncate text-xs text-fg"
              title={span.spanId ? `${span.label} — ${span.spanId}` : rowLabel(span.spanId, span.label)}
            >
              {span.service && <span className="mr-1 font-mono text-fg-muted">{span.service}</span>}
              {rowLabel(span.spanId, span.label)}
            </span>
            <div className="relative h-4">
              {span.endMs > span.startMs && (
                <div
                  aria-hidden="true"
                  className="absolute top-1 h-2 rounded-sm opacity-40"
                  style={{
                    left: percent(span.startMs),
                    width: `${((span.endMs - span.startMs) / totalMs) * 100}%`,
                    backgroundColor: span.hasError ? LEVEL_HEX.Error : LEVEL_HEX.Information,
                  }}
                />
              )}
              {span.events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  aria-label={t.trace.dotAria(event.level, event.message)}
                  title={t.trace.dotAria(event.level, event.message)}
                  onClick={() => onSelectEvent(event)}
                  className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full border border-bg"
                  style={{
                    left: percent(Date.parse(event.timestamp)),
                    backgroundColor: LEVEL_HEX[event.level],
                  }}
                />
              ))}
            </div>
            <span className="tabular text-right text-xs text-fg-muted">
              {span.endMs > span.startMs
                ? `${Math.round(span.endMs - span.startMs).toLocaleString(lang)} ms`
                : '—'}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-[minmax(8rem,16rem)_1fr_5rem] gap-2 text-[10px] text-fg-muted">
        <span />
        <span className="flex justify-between">
          <span>0 ms</span>
          <span>{Math.round(layout.endMs - layout.startMs).toLocaleString(lang)} ms</span>
        </span>
        <span />
      </div>
    </div>
  )
}
