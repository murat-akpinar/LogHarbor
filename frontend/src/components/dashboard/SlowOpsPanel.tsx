import { useNavigate } from 'react-router-dom'
import type { SlowOperationsResult } from '../../types'
import { useI18n } from '../../i18n'
import { quote } from '../../lib/filter'
import { PulsePanel, PulseRow } from './PulsePanel'

interface SlowOpsPanelProps {
  result: SlowOperationsResult | undefined
  from: string
  to: string
}

// the frontend never overrides the endpoint's `property` default, so the empty message names it
const SLOW_PROPERTY = 'Elapsed'

export function SlowOpsPanel({ result, from, to }: SlowOpsPanelProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const operations = result?.operations ?? []

  // same four-state reasoning as the Analysis page: which case emptied the list?
  const emptyText =
    result === undefined ? (
      ''
    ) : result.timedOperationCount === 0 ? (
      <>
        {t.analysis.noTimedOpsBefore}
        <span className="font-mono">{SLOW_PROPERTY}</span>
        {t.analysis.noTimedOpsAfter}
      </>
    ) : result.comparableOperationCount === 0 ? (
      t.analysis.noBaselineToCompare
    ) : (
      t.analysis.noSlowOps
    )

  function openEvents(template: string) {
    const params = new URLSearchParams({ from, to, filter: `@MessageTemplate = ${quote(template)}` })
    navigate(`/?${params.toString()}`)
  }

  return (
    <PulsePanel title={t.dashboard.slowestOps} to="/analysis" isEmpty={operations.length === 0} emptyText={emptyText}>
      {operations.map((op) => (
        <PulseRow
          key={op.template}
          onClick={() => openEvents(op.template)}
          left={<span className="truncate font-mono text-sm text-fg">{op.template}</span>}
          right={<span className="font-medium text-level-warning">{(op.currentP95 / op.baselineP95).toFixed(1)}×</span>}
        />
      ))}
    </PulsePanel>
  )
}
