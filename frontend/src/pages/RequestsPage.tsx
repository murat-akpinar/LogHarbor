import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { OperationOverview } from '../types'
import { useOperations } from '../hooks/useStats'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { TrendBars } from '../components/Sparkline'
import { OperationName } from '../components/OperationName'
import { StatusChart } from '../components/requests/StatusChart'
import { STATUS_FILTERS, statusFilter } from '../lib/status'
import type { StatusClass, StatusSelection } from '../lib/status'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { EmptyState, ErrorState, TableSkeletonBody } from '../components/ui/States'
import { Input } from '../components/ui/Input'
import { METHOD_PROPERTY, ROUTE_PROPERTY, operationFilter } from '../lib/operations'
import { SERIES } from '../lib/series'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50
// columns in each row's trend strip. They arrive with the rows rather than as a histogram
// request per row: at fifty rows that was fifty round trips which could not start until this
// page's one real query had already answered, and the table sat half-drawn until they landed.
const TREND_BUCKETS = 24

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

/** ?status=server from the dashboard's chart, ?status=502 from a link someone kept. */
function parseStatusParam(raw: string | null): StatusSelection | null {
  if (raw === null) return null
  if (raw in STATUS_FILTERS) return { kind: 'class', value: raw as StatusClass }
  const code = Number(raw)
  return Number.isInteger(code) && code >= 100 && code <= 599 ? { kind: 'code', value: code } : null
}

export function RequestsPage() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { live, range, presetKey, toggleLive, setRange, setPreset } = useLiveRange()
  const [sortKey, setSortKey] = useState<SortKey>('total')
  // ?status=server arrives from the dashboard's request chart: clicking 5xx there opens this
  // page already narrowed to it, rather than dropping the reader on the unfiltered table
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<StatusSelection | null>(() => parseStatusParam(searchParams.get('status')))
  // the sink decides the spelling: Path/Method here, RequestPath/RequestMethod under Serilog's
  // ASP.NET middleware, http.route under OTel. Blank falls back to grouping by message template
  const [routeProperty, setRouteProperty] = useState(ROUTE_PROPERTY)
  const [methodProperty, setMethodProperty] = useState(METHOD_PROPERTY)
  const filter = statusFilter(status)

  const operations = useOperations({
    ...range,
    filter,
    routeProperty: routeProperty || ROUTE_PROPERTY,
    methodProperty: methodProperty || METHOD_PROPERTY,
    limit: ROW_LIMIT,
    trendBuckets: TREND_BUCKETS,
  })
  const rangeMinutes = Math.max(1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000)

  const rows = [...(operations.data?.operations ?? [])].sort((a, b) => {
    if (sortKey === 'errorPct') return errorFraction(b) - errorFraction(a)
    // operations without a duration sort last
    if (sortKey === 'p95') return (b.p95ElapsedMs ?? -1) - (a.p95ElapsedMs ?? -1)
    return b.total - a.total
  })

  // the isolated class or code, when there is one, travels with every deep link and sparkline
  function rowFilter(op: OperationOverview): string {
    const clause = operationFilter(op, routeProperty, methodProperty)
    return filter ? `${clause} and ${filter}` : clause
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
            presetKey={presetKey}
            onRangeChange={setRange}
            onPreset={setPreset}
          />
        </div>
      </div>

      <SectionBlock icon="requests" title={t.requests.statusCodes} className="shrink-0">
        <Panel className="p-4">
          <StatusChart from={range.from} to={range.to} selected={status} onSelect={setStatus} title={null} />
        </Panel>
      </SectionBlock>

      <SectionBlock icon="analysis" title={t.dashboard.routes} meta={rows.length.toLocaleString(lang)}>
        <Panel className="overflow-x-auto">
        {/* the failure belongs where the rows would have been: a red band above a table that
            still draws its header reads as a page-level problem beside an empty table */}
        {operations.error ? (
          <ErrorState className="m-3" message={operations.error.message} onRetry={() => operations.refetch()} />
        ) : (
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
          {operations.isPending ? (
            <TableSkeletonBody columns={5} />
          ) : (
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
                    <TrendBars values={op.trend ?? []} color={SERIES.volume} />
                  </td>
                </tr>
              )
            })}
          </tbody>
          )}
        </table>
        )}
          {operations.data?.operations.length === 0 && (
            <EmptyState icon="requests" title={t.analysis.noOperations} />
          )}
        </Panel>
      </SectionBlock>
    </div>
  )
}
