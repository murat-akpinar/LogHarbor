import { useNavigate } from 'react-router-dom'
import type { TopError } from '../../types'
import { useI18n } from '../../i18n'
import { LevelBadge } from '../LevelBadge'
import { quote } from '../../lib/filter'
import { PulsePanel, PulseRow } from './PulsePanel'

interface TopErrorsPanelProps {
  errors: TopError[]
  from: string
  to: string
}

export function TopErrorsPanel({ errors, from, to }: TopErrorsPanelProps) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  function openEvents(template: string) {
    const params = new URLSearchParams({ from, to, filter: `@MessageTemplate = ${quote(template)}` })
    navigate(`/?${params.toString()}`)
  }

  return (
    <PulsePanel title={t.analysis.topErrors} to="/analysis" isEmpty={errors.length === 0} emptyText={t.analysis.noErrors}>
      {errors.map((row) => (
        <PulseRow
          key={`${row.level}\n${row.template}`}
          onClick={() => openEvents(row.template)}
          left={
            <>
              <LevelBadge level={row.level} />
              <span className="truncate font-mono text-sm text-fg">{row.template}</span>
            </>
          }
          right={<span className="text-fg-muted">{row.count.toLocaleString(lang)}</span>}
        />
      ))}
    </PulsePanel>
  )
}
