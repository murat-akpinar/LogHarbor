import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OperationOverview } from '../types'
import { useOperations } from '../hooks/useStats'
import { LiveToggle } from '../components/dashboard/LiveToggle'
import { Sparkline } from '../components/Sparkline'
import { StatusChart } from '../components/requests/StatusChart'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50
const REFRESH_MS = 10_000
const LIVE_WINDOW_MS = 60 * 60 * 1000 // rolling last hour

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

type SortKey = 'total' | 'errorPct' | 'p95'

// floor to the refresh interval so the query keys stay stable within a tick
function flooredNow() {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

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
  const [live, setLive] = useState(true)
  const [now, setNow] = useState(flooredNow)
  const [frozen, setFrozen] = useState<{ from: string; to: string } | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('total')

  const liveRange = useMemo(
    () => ({ from: new Date(now - LIVE_WINDOW_MS).toISOString(), to: new Date(now).toISOString() }),
    [now],
  )
  const range = live ? liveRange : (frozen ?? liveRange)

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [live])

  function toggleLive() {
    if (live) {
      setFrozen(range)
      setLive(false)
    } else {
      setNow(flooredNow())
      setFrozen(null)
      setLive(true)
    }
  }

  const operations = useOperations({ ...range, limit: ROW_LIMIT })
  const rangeMinutes = Math.max(1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000)

  const rows = [...(operations.data?.operations ?? [])].sort((a, b) => {
    if (sortKey === 'errorPct') return errorFraction(b) - errorFraction(a)
    // operations without a duration sort last
    if (sortKey === 'p95') return (b.p95ElapsedMs ?? -1) - (a.p95ElapsedMs ?? -1)
    return b.total - a.total
  })

  function openEvents(template: string) {
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      filter: `@MessageTemplate = ${quote(template)}`,
    })
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
        <div className="flex items-center gap-2">
          <LiveToggle live={live} onToggle={toggleLive} />
          {!live && (
            <TimeRangePicker
              from={range.from}
              to={range.to}
              onChange={(next) => {
                if (next.from) setFrozen({ from: next.from, to: next.to ?? new Date().toISOString() })
              }}
            />
          )}
        </div>
      </div>

      {operations.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{operations.error.message}</p>
      )}

      <StatusChart from={range.from} to={range.to} />

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
                  onClick={() => openEvents(op.template)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{op.template}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {(op.total / rangeMinutes).toLocaleString(lang, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  <td className={`${TD_CLASS} tabular text-right ${errorPct > 0 ? 'text-level-error' : ''}`}>
                    {errorPct.toFixed(1)}%
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {op.p95ElapsedMs === null ? '—' : formatMs(op.p95ElapsedMs, lang)}
                  </td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@MessageTemplate = ${quote(op.template)}`}
                      color={errorPct > 0 ? LEVEL_HEX.Error : LEVEL_HEX.Information}
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
