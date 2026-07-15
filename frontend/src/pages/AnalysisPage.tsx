import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TopError } from '../types'
import { useHistogram, useSlowOperations, useTopErrors, useTopExceptions } from '../hooks/useStats'
import { LevelBadge } from '../components/LevelBadge'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { LEVELS, LEVEL_HEX } from '../lib/levels'

const DEFAULT_RANGE_HOURS = 24
const ROW_LIMIT = 20
// baseline window start: anything before this predates the server itself
const BASELINE_START = '2000-01-01T00:00:00.000Z'

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Single-quote a value for the query language ('' escapes an embedded quote). */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

const SPARKLINE_BUCKETS = 24

/** Mini trend over the selected range for any filter, one bar per bucket. */
function Sparkline({ filter, color, from, to }: { filter: string; color: string; from: string; to: string }) {
  const histogram = useHistogram({ from, to, filter, buckets: SPARKLINE_BUCKETS })
  const totals = (histogram.data?.buckets ?? []).map((bucket) =>
    LEVELS.reduce((total, level) => total + bucket.counts[level], 0),
  )
  const max = Math.max(1, ...totals)

  return (
    <div className="flex h-5 w-24 items-end gap-px" aria-hidden="true">
      {totals.map((total, index) => (
        <span
          key={index}
          className="min-w-0 flex-1 rounded-t-[1px]"
          // 8% floor keeps single events visible next to the peak bucket
          style={{ height: total > 0 ? `${Math.max(8, (total / max) * 100)}%` : '0%', backgroundColor: color }}
        />
      ))}
    </div>
  )
}

/** ms with locale thousands grouping: 2559 -> "2.559 ms" (tr) / "2,559 ms" (en). */
function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString()} ms`
}

export function AnalysisPage() {
  const [range, setRange] = useState(defaultRange)
  const navigate = useNavigate()

  const errors = useTopErrors({ ...range, limit: ROW_LIMIT })
  const exceptions = useTopExceptions({ ...range, limit: ROW_LIMIT })
  const slow = useSlowOperations({ ...range, limit: ROW_LIMIT })
  // an error group is "new" when it never occurred before the selected range
  // ponytail: baseline is capped at the top 100 groups; rare templates beyond it flag as new
  const baseline = useTopErrors({ from: BASELINE_START, to: range.from, limit: 100 })
  const knownGroups = new Set((baseline.data?.errors ?? []).map((row) => `${row.level}\n${row.template}`))

  function isNew(row: TopError): boolean {
    return baseline.data !== undefined && !knownGroups.has(`${row.level}\n${row.template}`)
  }

  function openEvents(row: TopError) {
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      filter: `@MessageTemplate = ${quote(row.template)}`,
    })
    navigate(`/?${params.toString()}`)
  }

  const queryError = errors.error ?? exceptions.error

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">Analysis</h1>
        <TimeRangePicker
          from={range.from}
          to={range.to}
          onChange={(next) => {
            if (next.from && next.to) setRange({ from: next.from, to: next.to })
          }}
        />
      </div>

      {queryError && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queryError.message}</p>}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">Top errors</h2>
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>Message template</th>
                <th className={TH_CLASS}>Level</th>
                <th className={`${TH_CLASS} text-right`}>Count</th>
                <th className={TH_CLASS}>Trend</th>
                <th className={TH_CLASS}>First seen</th>
                <th className={TH_CLASS}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(errors.data?.errors ?? []).map((row) => (
                <tr
                  key={`${row.level}\n${row.template}`}
                  onClick={() => openEvents(row)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>
                    {row.template}
                    {isNew(row) && (
                      <span className="ml-2 rounded border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
                        new
                      </span>
                    )}
                  </td>
                  <td className={TD_CLASS}>
                    <LevelBadge level={row.level} />
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.count}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@Level = '${row.level}' and @MessageTemplate = ${quote(row.template)}`}
                      color={LEVEL_HEX[row.level]}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.data?.errors.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">No errors in the selected range.</p>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">Top exceptions</h2>
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>Exception type</th>
                <th className={`${TH_CLASS} text-right`}>Count</th>
                <th className={TH_CLASS}>First seen</th>
                <th className={TH_CLASS}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(exceptions.data?.exceptions ?? []).map((row) => (
                <tr key={row.type} className="border-b border-border last:border-b-0">
                  <td className={`${TD_CLASS} font-mono`}>{row.type}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.count}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {exceptions.data?.exceptions.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">No exceptions in the selected range.</p>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">Slower than usual</h2>
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>Operation</th>
                <th className={`${TH_CLASS} text-right`}>Usual p95</th>
                <th className={`${TH_CLASS} text-right`}>Now p95</th>
                <th className={`${TH_CLASS} text-right`}>× slower</th>
                <th className={`${TH_CLASS} text-right`}>Count</th>
                <th className={TH_CLASS}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {(slow.data?.operations ?? []).map((op) => (
                <tr
                  key={op.template}
                  onClick={() =>
                    navigate(
                      `/?${new URLSearchParams({ from: range.from, to: range.to, filter: `@MessageTemplate = ${quote(op.template)}` }).toString()}`,
                    )
                  }
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{op.template}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatMs(op.baselineP95)}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatMs(op.currentP95)}</td>
                  <td className={`${TD_CLASS} tabular text-right font-medium text-level-warning`}>
                    {(op.currentP95 / op.baselineP95).toFixed(1)}×
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{op.count}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@MessageTemplate = ${quote(op.template)}`}
                      color={LEVEL_HEX.Warning}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {slow.data?.operations.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">
              No operations are slower than usual. (Needs an <span className="font-mono">Elapsed</span> duration
              property on your events.)
            </p>
          )}
        </Card>
      </section>
    </div>
  )
}
