import { useEffect, useMemo, useState } from 'react'
import { useTopExceptions } from '../hooks/useStats'
import { LiveToggle } from '../components/dashboard/LiveToggle'
import { Sparkline } from '../components/Sparkline'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { exceptionStartsWith } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50
const REFRESH_MS = 10_000
const LIVE_WINDOW_MS = 60 * 60 * 1000 // rolling last hour

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

// floor to the refresh interval so the query keys stay stable within a tick
function flooredNow() {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

export function ExceptionsPage() {
  const { t, lang } = useI18n()
  const [live, setLive] = useState(true)
  const [now, setNow] = useState(flooredNow)
  const [frozen, setFrozen] = useState<{ from: string; to: string } | null>(null)

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

  const exceptions = useTopExceptions({ ...range, limit: ROW_LIMIT })
  const rows = exceptions.data?.exceptions ?? []
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t.exceptions.title}</h1>
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

      {exceptions.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{exceptions.error.message}</p>
      )}

      {exceptions.data && <p className="text-xl font-semibold text-fg">{t.exceptions.headline(total)}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.analysis.exceptionType}</th>
              <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
              <th className={TH_CLASS}>{t.analysis.trend}</th>
              <th className={TH_CLASS}>{t.analysis.firstSeen}</th>
              <th className={TH_CLASS}>{t.analysis.lastSeen}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type} className="border-b border-border last:border-b-0">
                <td className={`${TD_CLASS} font-mono`}>{row.type}</td>
                <td className={`${TD_CLASS} tabular text-right`}>{row.count.toLocaleString(lang)}</td>
                <td className={TD_CLASS}>
                  <Sparkline
                    filter={exceptionStartsWith(row.type)}
                    color={LEVEL_HEX.Error}
                    from={range.from}
                    to={range.to}
                  />
                </td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {exceptions.data && rows.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">{t.analysis.noExceptions}</p>
        )}
      </Card>
    </div>
  )
}
