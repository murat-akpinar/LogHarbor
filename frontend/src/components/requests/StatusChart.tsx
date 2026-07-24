import { useState } from 'react'
import { useHistogram } from '../../hooks/useStats'
import { Card } from '../ui/Card'
import { LEVELS, LEVEL_HEX } from '../../lib/levels'
import { formatTimestamp } from '../../lib/dates'
import { niceCeil } from '../../lib/niceScale'
import { useI18n } from '../../i18n'

const BUCKET_COUNT = 24
const PLOT_HEIGHT_PX = 128

/** Status classes as query-language filters; the page reuses them to narrow its table. */
export const STATUS_FILTERS = {
  ok: 'StatusCode < 400',
  client: 'StatusCode >= 400 and StatusCode < 500',
  server: 'StatusCode >= 500',
} as const

export type StatusClass = keyof typeof STATUS_FILTERS

const SERIES: { key: StatusClass; label: string; color: string }[] = [
  { key: 'ok', label: '1/2/3xx', color: LEVEL_HEX.Information },
  { key: 'client', label: '4xx', color: LEVEL_HEX.Warning },
  { key: 'server', label: '5xx', color: LEVEL_HEX.Error },
]

interface StatusChartProps {
  from: string
  to: string
  /** null shows every class stacked; a class isolates it here and in the caller's table. */
  selected: StatusClass | null
  onSelect: (next: StatusClass | null) => void
}

function bucketTotals(buckets: { start: string; counts: Record<string, number> }[] | undefined): number[] {
  return (buckets ?? []).map((bucket) => LEVELS.reduce((sum, level) => sum + bucket.counts[level], 0))
}

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function StatusChart({ from, to, selected, onSelect }: StatusChartProps) {
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
  const labelEvery = Math.max(1, Math.ceil(bucketCount / 6))
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  return (
    <Card className="shrink-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{t.requests.statusCodes}</h2>
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
          <div className="mt-3 flex gap-2">
            <div
              className="flex w-10 shrink-0 flex-col justify-between text-right text-xs text-fg-muted"
              style={{ height: PLOT_HEIGHT_PX }}
            >
              <span className="tabular">{niceMax.toLocaleString(lang)}</span>
              <span className="tabular">0</span>
            </div>
            <div
              className="flex min-w-0 flex-1 items-end gap-0.5 border-b border-border"
              style={{ height: PLOT_HEIGHT_PX }}
            >
              {Array.from({ length: bucketCount }, (_, index) => (
                <div
                  key={starts[index] ?? index}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  className="group relative flex h-full min-w-0 flex-1 flex-col-reverse gap-0.5"
                >
                  <span className="absolute inset-0 -m-px rounded-sm group-hover:bg-surface-hover" />
                  {series.map(({ key, color, data, dimmed }) => {
                    const count = data[index] ?? 0
                    if (count === 0 || dimmed) return null
                    return (
                      <span
                        key={key}
                        className="relative w-full shrink-0 rounded-sm transition-[height] duration-300"
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
          {/* mirrors the bars row's flex layout so each label sits under its bucket */}
          <div className="ml-12 flex gap-0.5">
            {Array.from({ length: bucketCount }, (_, index) => (
              <span key={starts[index] ?? index} className="min-w-0 flex-1 truncate text-center text-xs text-fg-muted">
                {index % labelEvery === 0 && starts[index] ? formatTime(starts[index], lang) : ''}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">{t.requests.noStatus}</p>
      )}
    </Card>
  )
}
