import { useNavigate } from 'react-router-dom'
import { useServices, useServiceStatus } from '../hooks/useStats'
import { Sparkline } from '../components/Sparkline'
import { ServiceStatusBoard } from '../components/ServiceStatusBoard'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { Card } from '../components/ui/Card'
import { quote } from '../lib/filter'
import { LEVEL_CHART } from '../lib/levels'
import { useI18n } from '../i18n'
import type { ServiceStatusRow } from '../types'

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000
const ROW_LIMIT = 50
const STATUS_LIMIT = 100

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

/** Events can carry either spelling, so the deep link matches both. */
function serviceFilter(service: string): string {
  return `(service.name = ${quote(service)} or Service = ${quote(service)})`
}

/** The probe's own lowercase schema (docs/service-status.md): one service's whole timeline. */
function probeFilter(row: ServiceStatusRow): string {
  return `Source = 'service-probe' and host = ${quote(row.host)} and service = ${quote(row.service)}`
}

export function ServicesPage() {
  const { t, lang } = useI18n()
  // a 24 h window like before, now pausable/livened from the same control as every other page
  const { live, range, toggleLive, setRange } = useLiveRange({ windowMs: DEFAULT_WINDOW_MS, initialLive: false })
  const navigate = useNavigate()

  const services = useServices({ ...range, limit: ROW_LIMIT })
  const status = useServiceStatus({ ...range, limit: STATUS_LIMIT })
  const rangeMinutes = Math.max(
    1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000)

  function openFilter(filter: string) {
    const params = new URLSearchParams({ from: range.from, to: range.to, filter })
    navigate(`/events?${params.toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.services.title}</h1>
        <LiveRangeControls
          live={live}
          onToggleLive={toggleLive}
          from={range.from}
          to={range.to}
          onRangeChange={setRange}
        />
      </div>

      {services.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{services.error.message}</p>
      )}

      <ServiceStatusBoard
        services={status.data?.services ?? []}
        onOpen={(row) => openFilter(probeFilter(row))}
      />

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
                onClick={() => openFilter(serviceFilter(row.service))}
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
                    color={row.errorCount > 0 ? LEVEL_CHART.Error : LEVEL_CHART.Information}
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
