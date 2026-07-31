import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useHistogram } from '../../hooks/useStats'
import { Card } from '../ui/Card'
import { SeriesChip } from '../ui/SeriesChip'
import { LEVELS } from '../../lib/levels'
import { STATUS_FILTERS, STATUS_SERIES } from '../../lib/status'
import type { StatusClass } from '../../lib/status'
import { formatTimestamp } from '../../lib/dates'
import { plotMax, sweep } from '../../lib/plotScale'
import { useI18n } from '../../i18n'

// matches the volume chart: enough columns to read the shape of an hour, each thin enough to
// read as a tick rather than a slab
const BUCKET_COUNT = 60
const PLOT_HEIGHT_PX = 128

interface StatusChartProps {
  from: string
  to: string
  /** null shows every class stacked; a class isolates it here and in the caller's table. */
  selected: StatusClass | null
  onSelect: (next: StatusClass | null) => void
  /** Defaults to "Status codes". null drops the heading for a caller whose section header
   *  already carries it, leaving the chips as the chart's own row. */
  title?: string | null
  /** A link out, for callers that are only sampling this (the dashboard). */
  action?: ReactNode
}

/** Frameless on purpose: the Requests page puts it in a card, the dashboard in a section well. */

function bucketTotals(buckets: { start: string; counts: Record<string, number> }[] | undefined): number[] {
  return (buckets ?? []).map((bucket) => LEVELS.reduce((sum, level) => sum + bucket.counts[level], 0))
}

export function StatusChart({ from, to, selected, onSelect, title, action }: StatusChartProps) {
  const { t, lang } = useI18n()
  const [hovered, setHovered] = useState<number | null>(null)
  const shared = { from, to, buckets: BUCKET_COUNT }

  const queries = {
    ok: useHistogram({ ...shared, filter: STATUS_FILTERS.ok }),
    client: useHistogram({ ...shared, filter: STATUS_FILTERS.client }),
    server: useHistogram({ ...shared, filter: STATUS_FILTERS.server }),
  }

  const series = STATUS_SERIES.map((entry) => ({
    ...entry,
    data: bucketTotals(queries[entry.key].data?.buckets),
    dimmed: selected !== null && selected !== entry.key,
  }))
  const starts = queries.ok.data?.buckets.map((bucket) => bucket.start) ?? []
  const bucketCount = Math.max(...series.map((s) => s.data.length), 0)
  const visible = series.filter((s) => !s.dimmed)

  const max = plotMax(
    Array.from({ length: bucketCount }, (_, i) => visible.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)),
  )
  const grandTotal = series.reduce((sum, s) => sum + s.data.reduce((a, b) => a + b, 0), 0)
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title === null ? (
          <span>{action}</span>
        ) : (
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
            <span className="truncate">{title ?? t.requests.statusCodes}</span>
            {action}
          </h2>
        )}
        <div className="flex items-center gap-1.5">
          {series.map(({ key, label, color, data, dimmed }) => (
            <SeriesChip
              key={key}
              color={color}
              label={label}
              value={compact(data.reduce((a, b) => a + b, 0))}
              pressed={selected === key}
              dimmed={dimmed}
              onClick={() => onSelect(selected === key ? null : key)}
              title={selected === key ? t.requests.showAll : t.requests.onlyThis(label)}
            />
          ))}
        </div>
      </div>

      {grandTotal > 0 ? (
        <>
          <div className="mt-3">
            <div
              className="flex min-w-0 items-end gap-[2px]"
              style={{ height: PLOT_HEIGHT_PX }}
            >
              {Array.from({ length: bucketCount }, (_, index) => (
                // keyed by position, not by timestamp: in live mode the window moves every ten
                // seconds and keying on the start would replay the entrance on every refresh
                <div
                  key={index}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  className="group animate-grow relative flex h-full min-w-0 flex-1 flex-col-reverse"
                  style={{ '--delay': `${sweep(index, bucketCount)}ms` } as CSSProperties}
                >
                  <span className="absolute inset-0 -m-px rounded-sm group-hover:bg-surface-hover" />
                  {series.map(({ key, color, data, dimmed }) => {
                    const count = data[index] ?? 0
                    if (count === 0 || dimmed) return null
                    return (
                      <span
                        key={key}
                        className="relative w-full shrink-0 rounded-t-[2px] transition-[height] duration-500"
                        style={{ height: `${(count / max) * 100}%`, minHeight: '1px', backgroundColor: color }}
                      />
                    )
                  })}
                  {hovered === index && starts[index] && (
                    <Card pop className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-40 -translate-x-1/2 p-2 text-xs">
                      <p className="mb-1 text-fg-muted">{formatTimestamp(starts[index], lang)}</p>
                      {series.map(({ key, label, color, data }) => (
                        <div key={key} className="flex items-center gap-2 py-0.5">
                          <span
                            className="h-0.5 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                          <span className="tabular font-semibold text-fg">{data[index] ?? 0}</span>
                          <span className="text-fg-muted">{label}</span>
                        </div>
                      ))}
                    </Card>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* no axis and no per-bucket ticks: the window's two ends place every bar, and the
              exact numbers are already one hover away */}
          <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-xs text-fg-subtle">
            <span>{starts[0] ? formatTimestamp(starts[0], lang) : ''}</span>
            <span>{formatTimestamp(to, lang)}</span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">{t.requests.noStatus}</p>
      )}
    </div>
  )
}
