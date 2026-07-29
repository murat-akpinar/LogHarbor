import { useHistogram } from '../hooks/useStats'
import { LEVELS } from '../lib/levels'

const SPARKLINE_BUCKETS = 24

/** The bar strip itself, for callers that already hold the numbers and must not fetch again. */
export function TrendBars({
  values,
  color,
  className = 'h-5 w-24',
}: {
  values: number[]
  color: string
  className?: string
}) {
  const max = Math.max(1, ...values)
  return (
    <div className={`flex items-end gap-px ${className}`} aria-hidden="true">
      {values.map((total, index) => (
        <span
          key={index}
          className="min-w-0 flex-1 rounded-t-[1px]"
          // 8% floor keeps single events visible next to the peak bucket
          style={{ height: total > 0 ? `${Math.max(8, (total / max) * 100)}%` : '0%', backgroundColor: color }}
        />
      ))}
    </div>
  )
}

/** Mini trend over the selected range for any filter, one bar per bucket. */
export function Sparkline({ filter, color, from, to }: { filter: string; color: string; from: string; to: string }) {
  const histogram = useHistogram({ from, to, filter, buckets: SPARKLINE_BUCKETS })
  const totals = (histogram.data?.buckets ?? []).map((bucket) =>
    LEVELS.reduce((total, level) => total + bucket.counts[level], 0),
  )

  return <TrendBars values={totals} color={color} />
}
