import { useNavigate } from 'react-router-dom'
import type { OperationOverview } from '../../types'
import { useI18n } from '../../i18n'
import { quote } from '../../lib/filter'
import { PulsePanel, PulseRow } from './PulsePanel'

interface RoutesPanelProps {
  operations: OperationOverview[]
  from: string
  to: string
}

// "Routes" in the Nightwatch sense: the busiest operations (message templates) with their
// p95 latency. Operations are already ordered by volume by /api/stats/operations.
export function RoutesPanel({ operations, from, to }: RoutesPanelProps) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  function openEvents(template: string) {
    const params = new URLSearchParams({ from, to, filter: `@MessageTemplate = ${quote(template)}` })
    navigate(`/events?${params.toString()}`)
  }

  return (
    <PulsePanel title={t.dashboard.routes} to="/analysis" isEmpty={operations.length === 0} emptyText={t.analysis.noOperations}>
      {operations.map((op) => (
        <PulseRow
          key={op.template}
          onClick={() => openEvents(op.template)}
          left={<span className="truncate font-mono text-sm text-fg">{op.template}</span>}
          right={
            <span className="text-fg-muted">
              {op.p95ElapsedMs === null ? '—' : `${Math.round(op.p95ElapsedMs).toLocaleString(lang)} ms`}
            </span>
          }
        />
      ))}
    </PulsePanel>
  )
}
