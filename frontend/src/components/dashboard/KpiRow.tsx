import type { StatsSummary } from '../../types'
import { Card } from '../ui/Card'
import { useI18n } from '../../i18n'

type Tone = 'default' | 'error' | 'warning'

const TONE_CLASS: Record<Tone, string> = {
  default: 'text-fg',
  error: 'text-level-error',
  warning: 'text-level-warning',
}

function KpiTile({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={`tabular text-3xl font-semibold ${TONE_CLASS[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-fg-muted">{sub}</p>}
    </Card>
  )
}

interface KpiRowProps {
  summary: StatsSummary | undefined
  /** Length of the queried window, used to turn a total into a per-minute rate. */
  windowMinutes: number
}

/** The hero: throughput, error rate, and the two levels worth calling out, as large figures. */
export function KpiRow({ summary, windowMinutes }: KpiRowProps) {
  const { t, lang } = useI18n()
  const total = summary?.total ?? 0
  const errors = (summary?.byLevel.Error ?? 0) + (summary?.byLevel.Fatal ?? 0)
  const warnings = summary?.byLevel.Warning ?? 0
  const errorRate = total > 0 ? (errors / total) * 100 : 0
  const throughput = total / Math.max(1, windowMinutes)

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile
        label={t.dashboard.throughput}
        value={throughput.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        sub={t.dashboard.eventsPerMin}
      />
      <KpiTile label={t.dashboard.errorRate} value={`${errorRate.toFixed(1)}%`} tone={errorRate > 0 ? 'error' : 'default'} />
      <KpiTile label={t.dashboard.errors} value={errors.toLocaleString(lang)} tone={errors > 0 ? 'error' : 'default'} />
      <KpiTile label={t.dashboard.warnings} value={warnings.toLocaleString(lang)} tone={warnings > 0 ? 'warning' : 'default'} />
    </div>
  )
}
