import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { OperationOverview } from '../types'
import { useOperations } from '../hooks/useStats'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { Sparkline } from '../components/Sparkline'
import { OperationName } from '../components/OperationName'
import { StatusChart } from '../components/requests/StatusChart'
import { STATUS_FILTERS } from '../lib/status'
import type { StatusClass } from '../lib/status'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { METHOD_PROPERTY, ROUTE_PROPERTY, operationFilter } from '../lib/operations'
import { LEVEL_CHART } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

type SortKey = 'total' | 'errorPct' | 'p95'

/** ms with locale thousands grouping: 2559 -> "2.559 ms" (tr) / "2,559 ms" (en). */
function formatMs(ms: number, locale: string): string {
  return `${Math.round(ms).toLocaleString(locale)} ms`
}

function errorFraction(op: OperationOverview): number {
  return op.total > 0 ? op.errorCount / op.total : 0
}

export function RequestsPage() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { live, range, toggleLive, setRange } = useLiveRange()
  const [sortKey, setSortKey] = useState<SortKey>('total')
  // ?status=server arrives from the dashboard's request chart: clicking 5xx there opens this
  // page already narrowed to it, rather than dropping the reader on the unfiltered table
  const [searchParams] = useSearchParams()
  const requestedStatus = searchParams.get('status')
  const [statusClass, setStatusClass] = useState<StatusClass | null>(
    requestedStatus !== null && requestedStatus in STATUS_FILTERS ? (requestedStatus as StatusClass) : null,
  )
  // the sink decides the spelling: Path/Method here, RequestPath/RequestMethod under Serilog's
  // ASP.NET middleware, http.route under OTel. Blank falls back to grouping by message template
  const [routeProperty, setRouteProperty] = useState(ROUTE_PROPERTY)
  const [methodProperty, setMethodProperty] = useState(METHOD_PROPERTY)
  const statusFilter = statusClass ? STATUS_FILTERS[statusClass] : undefined

  const operations = useOperations({
    ...range,
    filter: statusFilter,
    routeProperty: routeProperty || ROUTE_PROPERTY,
    methodProperty: methodProperty || METHOD_PROPERTY,
    limit: ROW_LIMIT,
  })
  const rangeMinutes = Math.max(1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000)

  const rows = [...(operations.data?.operations ?? [])].sort((a, b) => {
    if (sortKey === 'errorPct') return errorFraction(b) - errorFraction(a)
    // operations without a duration sort last
    if (sortKey === 'p95') return (b.p95ElapsedMs ?? -1) - (a.p95ElapsedMs ?? -1)
    return b.total - a.total
  })

  // the status class, when one is isolated, travels with every deep link and sparkline
  function rowFilter(op: OperationOverview): string {
    const clause = operationFilter(op, routeProperty, methodProperty)
    return statusFilter ? `${clause} and ${statusFilter}` : clause
  }

  function openEvents(op: OperationOverview) {
    const params = new URLSearchParams({ from: range.from, to: range.to, filter: rowFilter(op) })
    navigate(`/events?${params.toString()}`)
  }

  function sortableHeader(key: SortKey, label: string) {
    return (
      <th className={`${TH_CLASS} text-right`} aria-sort={sortKey === key ? 'descending' : undefined}>
        <button
          type="button"
          onClick={() => setSortKey(key)}
          className={`transition-colors hover:text-fg ${sortKey === key ? 'text-fg' : ''}`}
        >
          {label}
          {sortKey === key ? ' ↓' : ''}
        </button>
      </th>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.requests.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.requests.routeProperty}
            <Input
              aria-label={t.requests.routeProperty}
              value={routeProperty}
              onChange={(event) => setRouteProperty(event.target.value)}
              className="w-28 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.requests.methodProperty}
            <Input
              aria-label={t.requests.methodProperty}
              value={methodProperty}
              onChange={(event) => setMethodProperty(event.target.value)}
              className="w-28 font-mono text-xs"
            />
          </label>
          <LiveRangeControls
            live={live}
            onToggleLive={toggleLive}
            from={range.from}
            to={range.to}
            onRangeChange={setRange}
          />
        </div>
      </div>

      {operations.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{operations.error.message}</p>
      )}

      <Card className="shrink-0 p-4">
        <StatusChart from={range.from} to={range.to} selected={statusClass} onSelect={setStatusClass} />
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.analysis.operation}</th>
              {sortableHeader('total', t.analysis.eventsPerMin)}
              {sortableHeader('errorPct', t.analysis.errorPct)}
              {sortableHeader('p95', t.analysis.p95)}
              <th className={TH_CLASS}>{t.analysis.trend}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((op) => {
              const errorPct = errorFraction(op) * 100
              return (
                <tr
                  key={op.template}
                  onClick={() => openEvents(op)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={TD_CLASS}>
                    <OperationName operation={op} />
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {(op.total / rangeMinutes).toLocaleString(lang, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  {/* a mark, not a coloured row: only the figure that is wrong changes colour */}
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {errorPct > 0 ? (
                      <span className="inline-block rounded bg-level-error/12 px-1.5 py-0.5 text-level-error">
                        {errorPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-fg-subtle">{errorPct.toFixed(1)}%</span>
                    )}
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {op.p95ElapsedMs === null ? '—' : formatMs(op.p95ElapsedMs, lang)}
                  </td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={rowFilter(op)}
                      color={errorPct > 0 ? LEVEL_CHART.Error : LEVEL_CHART.Information}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {operations.data?.operations.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">{t.analysis.noOperations}</p>
        )}
      </Card>
    </div>
  )
}
