import type { TopException } from '../../types'
import { useI18n } from '../../i18n'
import { PulsePanel, PulseRow } from './PulsePanel'

interface ExceptionsPanelProps {
  exceptions: TopException[]
}

// There is no @ExceptionType query builtin, so rows aren't individually deep-linked; the
// header link opens the full Analysis table where exception grouping lives.
export function ExceptionsPanel({ exceptions }: ExceptionsPanelProps) {
  const { t, lang } = useI18n()
  return (
    <PulsePanel
      title={t.analysis.topExceptions}
      to="/analysis"
      isEmpty={exceptions.length === 0}
      emptyText={t.analysis.noExceptions}
    >
      {exceptions.map((row) => (
        <PulseRow
          key={row.type}
          left={<span className="truncate font-mono text-sm text-fg">{row.type}</span>}
          right={<span className="text-fg-muted">{row.count.toLocaleString(lang)}</span>}
        />
      ))}
    </PulsePanel>
  )
}
