import { useNavigate } from 'react-router-dom'
import type { ServiceOverview } from '../../types'
import { useI18n } from '../../i18n'
import { quote } from '../../lib/filter'
import { PulsePanel, PulseRow } from './PulsePanel'

interface ServicesPanelProps {
  services: ServiceOverview[]
  from: string
  to: string
}

/** Events can carry either spelling, so the deep link matches both (mirrors ServicesPage). */
function serviceFilter(service: string): string {
  return `(service.name = ${quote(service)} or Service = ${quote(service)})`
}

export function ServicesPanel({ services, from, to }: ServicesPanelProps) {
  const { t } = useI18n()
  const navigate = useNavigate()

  function openEvents(service: string) {
    const params = new URLSearchParams({ from, to, filter: serviceFilter(service) })
    navigate(`/?${params.toString()}`)
  }

  return (
    <PulsePanel title={t.dashboard.serviceHealth} to="/services" isEmpty={services.length === 0} emptyText={t.services.empty}>
      {services.map((row) => {
        const errorPct = row.total > 0 ? (row.errorCount / row.total) * 100 : 0
        return (
          <PulseRow
            key={row.service}
            onClick={() => openEvents(row.service)}
            left={<span className="truncate font-mono text-sm text-fg">{row.service}</span>}
            right={<span className={errorPct > 0 ? 'text-level-error' : 'text-fg-muted'}>{errorPct.toFixed(1)}%</span>}
          />
        )
      })}
    </PulsePanel>
  )
}
