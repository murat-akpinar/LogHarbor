import { useHistogram } from '../../hooks/useStats'
import { Card } from '../ui/Card'
import { LEVELS, LEVEL_HEX } from '../../lib/levels'
import { useI18n } from '../../i18n'

const BUCKET_COUNT = 24

interface StatusChartProps {
  from: string
  to: string
}

function totals(buckets: { counts: Record<string, number> }[] | undefined): number[] {
  return (buckets ?? []).map((bucket) => LEVELS.reduce((sum, level) => sum + bucket.counts[level], 0))
}

/** Nightwatch-style stacked status-class histogram over events carrying a StatusCode property. */
export function StatusChart({ from, to }: StatusChartProps) {
  const { t, lang } = useI18n()
  const shared = { from, to, buckets: BUCKET_COUNT }
  const ok = useHistogram({ ...shared, filter: 'StatusCode < 400' })
  const clientErrors = useHistogram({ ...shared, filter: 'StatusCode >= 400 and StatusCode < 500' })
  const serverErrors = useHistogram({ ...shared, filter: 'StatusCode >= 500' })

  // bottom-to-top stacking order; colors follow the app's level semantics
  const series = [
    { label: '1/2/3xx', color: LEVEL_HEX.Information, data: totals(ok.data?.buckets) },
    { label: '4xx', color: LEVEL_HEX.Warning, data: totals(clientErrors.data?.buckets) },
    { label: '5xx', color: LEVEL_HEX.Error, data: totals(serverErrors.data?.buckets) },
  ]
  const bucketCount = Math.max(...series.map((s) => s.data.length), 0)
  const stackedMax = Math.max(
    1,
    ...Array.from({ length: bucketCount }, (_, i) => series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)),
  )
  const grandTotal = series.reduce((sum, s) => sum + s.data.reduce((a, b) => a + b, 0), 0)
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  return (
    <Card className="shrink-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{t.requests.statusCodes}</h2>
        <div className="flex items-center gap-4 text-xs">
          {series.map(({ label, color, data }) => (
            <span key={label} className="flex items-center gap-1.5 text-fg-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              {label}
              <span className="tabular font-medium text-fg">{compact(data.reduce((a, b) => a + b, 0))}</span>
            </span>
          ))}
        </div>
      </div>
      {grandTotal > 0 ? (
        <div className="mt-3 flex h-24 items-stretch gap-px" aria-hidden="true">
          {Array.from({ length: bucketCount }, (_, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col-reverse">
              {series.map(({ label, color, data }) => {
                const count = data[i] ?? 0
                return count > 0 ? (
                  <span
                    key={label}
                    className="w-full first:rounded-t-[1px]"
                    style={{ height: `${(count / stackedMax) * 100}%`, backgroundColor: color }}
                  />
                ) : null
              })}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">{t.requests.noStatus}</p>
      )}
    </Card>
  )
}
