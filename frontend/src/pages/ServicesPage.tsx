import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useServices } from '../hooks/useStats'
import { Sparkline } from '../components/Sparkline'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const DEFAULT_RANGE_HOURS = 24
const ROW_LIMIT = 50

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

/** Events can carry either spelling, so the deep link matches both. */
function serviceFilter(service: string): string {
  return `(service.name = ${quote(service)} or Service = ${quote(service)})`
}

export function ServicesPage() {
  const { t, lang } = useI18n()
  const [range, setRange] = useState(defaultRange)
  const navigate = useNavigate()

  const services = useServices({ ...range, limit: ROW_LIMIT })
  const rangeMinutes = Math.max(
    1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000)

  function openEvents(service: string) {
    const params = new URLSearchParams({ from: range.from, to: range.to, filter: serviceFilter(service) })
    navigate(`/?${params.toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.services.title}</h1>
        <TimeRangePicker
          from={range.from}
          to={range.to}
          onChange={(next) => {
            // presets leave `to` open-ended; rate math needs a closed window, so pin it to now
            if (next.from) setRange({ from: next.from, to: next.to ?? new Date().toISOString() })
          }}
        />
      </div>

      {services.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{services.error.message}</p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.services.service}</th>
              <th className={`${TH_CLASS} text-right`}>{t.services.rate}</th>
              <th className={`${TH_CLASS} text-right`}>{t.services.errors}</th>
              <th className={`${TH_CLASS} text-right`}>{t.services.p95}</th>
              <th className={TH_CLASS}>{t.services.trend}</th>
            </tr>
          </thead>
          <tbody>
            {(services.data?.services ?? []).map((row) => (
              <tr
                key={row.service}
                onClick={() => openEvents(row.service)}
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
              >
                <td className={`${TD_CLASS} font-mono`}>{row.service}</td>
                <td className={`${TD_CLASS} tabular text-right`}>
                  {(row.total / rangeMinutes).toLocaleString(lang, {
                    minimumFractionDigits: 1, maximumFractionDigits: 1,
                  })}
                </td>
                <td className={`${TD_CLASS} tabular text-right ${row.errorCount > 0 ? 'text-level-error' : ''}`}>
                  {((row.errorCount / row.total) * 100).toFixed(1)}%
                </td>
                <td className={`${TD_CLASS} tabular text-right`}>
                  {row.p95ElapsedMs === null ? '—' : `${Math.round(row.p95ElapsedMs).toLocaleString(lang)} ms`}
                </td>
                <td className={TD_CLASS}>
                  <Sparkline
                    filter={serviceFilter(row.service)}
                    color={row.errorCount > 0 ? LEVEL_HEX.Error : LEVEL_HEX.Information}
                    from={range.from}
                    to={range.to}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {services.data?.services.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">{t.services.empty}</p>
        )}
      </Card>
    </div>
  )
}
