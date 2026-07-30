import { useState } from 'react'
import type { ReactNode } from 'react'
import { useHistogram } from '../../hooks/useStats'
import { Card } from '../ui/Card'
import { LEVELS, LEVEL_CHART } from '../../lib/levels'
import { formatTimestamp } from '../../lib/dates'
import { niceCeil } from '../../lib/niceScale'
import { useI18n } from '../../i18n'

// matches the volume chart: enough columns to read the shape of an hour, each thin enough to
// read as a tick rather than a slab
const BUCKET_COUNT = 60
const PLOT_HEIGHT_PX = 128

/** Status classes as query-language filters; the page reuses them to narrow its table. */
export const STATUS_FILTERS = {
  ok: 'StatusCode < 400',
  client: 'StatusCode >= 400 and StatusCode < 500',
  server: 'StatusCode >= 500',
} as const

export type StatusClass = keyof typeof STATUS_FILTERS

const SERIES: { key: StatusClass; label: string; color: string }[] = [
  // the healthy class draws neutral: a wall of colour says nothing, and 4xx/5xx have to be the
  // only things in this chart that catch the eye
  { key: 'ok', label: '1/2/3xx', color: LEVEL_CHART.Information },
  { key: 'client', label: '4xx', color: LEVEL_CHART.Warning },
  { key: 'server', label: '5xx', color: LEVEL_CHART.Error },
]

interface StatusChartProps {
  from: string
  to: string
  /** null shows every class stacked; a class isolates it here and in the caller's table. */
  selected: StatusClass | null
  onSelect: (next: StatusClass | null) => void
  /** Defaults to "Status codes". The dashboard calls it Requests, because there it is the
   *  request chart rather than one control on a page that is already about requests. */
  title?: string
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

  const series = SERIES.map((entry) => ({
    ...entry,
    data: bucketTotals(queries[entry.key].data?.buckets),
    dimmed: selected !== null && selected !== entry.key,
  }))
  const starts = queries.ok.data?.buckets.map((bucket) => bucket.start) ?? []
  const bucketCount = Math.max(...series.map((s) => s.data.length), 0)
  const visible = series.filter((s) => !s.dimmed)

  const niceMax = niceCeil(
    Math.max(1, ...Array.from({ length: bucketCount }, (_, i) => visible.reduce((sum, s) => sum + (s.data[i] ?? 0), 0))),
  )
  const grandTotal = series.reduce((sum, s) => sum + s.data.reduce((a, b) => a + b, 0), 0)
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <span className="truncate">{title ?? t.requests.statusCodes}</span>
          {action}
        </h2>
        <div className="flex items-center gap-1.5">
          {series.map(({ key, label, color, data, dimmed }) => (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(selected === key ? null : key)}
              aria-pressed={selected === key}
              title={selected === key ? t.requests.showAll : t.requests.onlyThis(label)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                selected === key
                  ? 'border-accent/50 bg-accent/10 text-fg'
                  : `border-border-strong bg-surface hover:bg-surface-hover ${dimmed ? 'opacity-50' : ''}`
              }`}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              <span className="text-fg-muted">{label}</span>
              <span className="tabular font-medium text-fg">{compact(data.reduce((a, b) => a + b, 0))}</span>
            </button>
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
                <div
                  key={starts[index] ?? index}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  className="group relative flex h-full min-w-0 flex-1 flex-col-reverse"
                >
                  <span className="absolute inset-0 -m-px rounded-sm group-hover:bg-surface-hover" />
                  {series.map(({ key, color, data, dimmed }) => {
                    const count = data[index] ?? 0
                    if (count === 0 || dimmed) return null
                    return (
                      <span
                        key={key}
                        className="relative w-full shrink-0 transition-[height] duration-300"
                        style={{ height: `${(count / niceMax) * 100}%`, backgroundColor: color }}
                      />
                    )
                  })}
                  {hovered === index && starts[index] && (
                    <Card className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-40 -translate-x-1/2 p-2 text-xs">
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
