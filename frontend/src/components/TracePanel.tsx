import { useMemo } from 'react'
import type { Event } from '../types'
import { useTraceEvents } from '../hooks/useTraceEvents'
import { buildTraceLayout } from '../lib/trace'
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
  const trace = useTraceEvents(traceId)
  const layout = useMemo(() => buildTraceLayout(trace.data?.events ?? []), [trace.data])

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
      {trace.data?.hasMore && <p className="mb-2 text-xs text-fg-muted">{t.trace.truncated}</p>}

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
