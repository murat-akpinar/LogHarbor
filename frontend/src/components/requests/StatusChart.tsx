import { useState } from 'react'
import type { ReactNode } from 'react'
import { useHistogram, usePropertyValues } from '../../hooks/useStats'
import { Card } from '../ui/Card'
import { SeriesChip } from '../ui/SeriesChip'
import { ErrorState } from '../ui/States'
import { LEVELS } from '../../lib/levels'
import { STATUS_COLOR, STATUS_FILTERS, STATUS_PROPERTY, STATUS_SERIES, statusClassOf, statusFilter } from '../../lib/status'
import type { StatusSelection } from '../../lib/status'
import { formatTimestamp } from '../../lib/dates'
import { plotMax } from '../../lib/plotScale'
import { barFill, barGlow } from '../../lib/series'
import { useI18n } from '../../i18n'
import { TimeAxis } from '../TimeAxis'

// matches the volume chart: enough columns to read the shape of an hour, each thin enough to
// read as a tick rather than a slab
const BUCKET_COUNT = 60
const PLOT_HEIGHT_PX = 128
// distinct codes to break the range down into. An HTTP application uses a dozen; the ceiling is
// only there so a property holding something other than a status code cannot fill the row.
const CODE_LIMIT = 24

interface StatusChartProps {
  from: string
  to: string
  /** null shows every class stacked; a class or one exact code isolates it here and in the
   *  caller's table. */
  selected: StatusSelection | null
  onSelect: (next: StatusSelection | null) => void
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
  // an isolated code gets its own shape over the window rather than its class's: when the
  // upstream went away is the question a chosen 502 is asking
  const code = selected?.kind === 'code' ? selected.value : null
  const codeHistogram = useHistogram(
    { ...shared, filter: statusFilter(selected) },
    { enabled: code !== null },
  )
  const codes = usePropertyValues({ from, to, property: STATUS_PROPERTY, limit: CODE_LIMIT })
  // a request that failed is not a window with no status codes in it, and the hint below says
  // exactly that — so the failure has to be told apart from the emptiness it looks like
  const failure = queries.ok.error ?? queries.client.error ?? queries.server.error

  const classSeries = STATUS_SERIES.map((entry) => ({
    ...entry,
    data: bucketTotals(queries[entry.key].data?.buckets),
    dimmed: selected !== null && !(selected.kind === 'class' && selected.value === entry.key),
  }))
  const series =
    code === null
      ? classSeries
      : [
          {
            key: String(code),
            label: String(code),
            color: STATUS_COLOR[statusClassOf(code)],
            lit: statusClassOf(code) !== 'ok',
            data: bucketTotals(codeHistogram.data?.buckets),
            dimmed: false,
          },
        ]
  const starts = queries.ok.data?.buckets.map((bucket) => bucket.start) ?? []
  const bucketCount = Math.max(...series.map((s) => s.data.length), 0)
  const visible = series.filter((s) => !s.dimmed)

  const max = plotMax(
    Array.from({ length: bucketCount }, (_, i) => visible.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)),
  )
  const grandTotal = series.reduce((sum, s) => sum + s.data.reduce((a, b) => a + b, 0), 0)
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  // always the three classes, even while a code is isolated: they are the chart's legend when
  // nothing is chosen and the way back up to a whole class when something is
  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {classSeries.map(({ key, label, color, data, dimmed }) => {
        const pressed = selected?.kind === 'class' && selected.value === key
        return (
          <SeriesChip
            key={key}
            color={color}
            label={label}
            // no count while the request for it is failing: a chip reading 0 is a claim about
            // the data, and there is no data
            value={failure ? undefined : compact(data.reduce((a, b) => a + b, 0))}
            pressed={pressed}
            dimmed={dimmed}
            onClick={() => onSelect(pressed ? null : { kind: 'class', value: key })}
            title={pressed ? t.requests.showAll : t.requests.onlyThis(label)}
          />
        )
      })}
    </div>
  )

  // The breakdown the classes cannot give: 500, 502 and 503 are the application throwing, the
  // upstream being gone and the service shedding load, and a class chip paints all three one red.
  // Ascending, so the row reads as a ladder from the healthy codes to the ones worth opening.
  const codeChips = (codes.data?.values ?? [])
    .map((value) => ({ code: Number(value.value), count: value.count }))
    .filter((entry) => Number.isFinite(entry.code))
    .sort((left, right) => left.code - right.code)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title === null ? (
          // The section header above already names this chart, so the chips are the whole of its
          // header row and they start at the left edge — where Events puts its level chips, which
          // are the same kind of control. Right-aligned against an empty space, they were the one
          // filter row in the app that sat somewhere else, and moving between the two pages made
          // them jump across the screen.
          <>
            {chips}
            {action}
          </>
        ) : (
          <>
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
              <span className="truncate">{title ?? t.requests.statusCodes}</span>
              {action}
            </h2>
            {chips}
          </>
        )}
      </div>

      {failure ? (
        <ErrorState
          className="mt-3"
          message={failure.message}
          onRetry={() => {
            void queries.ok.refetch()
            void queries.client.refetch()
            void queries.server.refetch()
            void codes.refetch()
          }}
        />
      ) : grandTotal > 0 ? (
        <>
          <div className="mt-3">
            <div
              className="flex min-w-0 items-end gap-[2px]"
              style={{ height: PLOT_HEIGHT_PX }}
            >
              {Array.from({ length: bucketCount }, (_, index) => (
                // keyed by position, not by timestamp: in live mode the window moves every ten
                // seconds and keying on the start would remount every bar
                <div
                  key={index}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  className="group relative flex h-full min-w-0 flex-1 flex-col-reverse"
                >
                  <span className="absolute inset-0 -m-px rounded-sm group-hover:bg-surface-hover" />
                  {series.map(({ key, color, data, dimmed, lit }) => {
                    const count = data[index] ?? 0
                    if (count === 0 || dimmed) return null
                    return (
                      <span
                        key={key}
                        className="relative w-full shrink-0 rounded-t-[2px]"
                        style={{
                          height: `${(count / max) * 100}%`,
                          minHeight: '1px',
                          background: barFill(color),
                          boxShadow: lit ? barGlow(color) : undefined,
                        }}
                      />
                    )
                  })}
                  {hovered === index && starts[index] && (
                    <Card variant="float" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-40 -translate-x-1/2 p-2 text-xs">
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
          {starts[0] && <TimeAxis from={starts[0]} to={to} className="mt-1.5" />}
        </>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">{t.requests.noStatus}</p>
      )}

      {codeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-0.5 text-xs text-fg-subtle">{t.requests.byCode}</span>
          {codeChips.map(({ code: value, count }) => (
            <SeriesChip
              key={value}
              color={STATUS_COLOR[statusClassOf(value)]}
              label={String(value)}
              value={compact(count)}
              pressed={code === value}
              dimmed={code !== null && code !== value}
              onClick={() => onSelect(code === value ? null : { kind: 'code', value })}
              title={code === value ? t.requests.showAll : t.requests.onlyThis(String(value))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
