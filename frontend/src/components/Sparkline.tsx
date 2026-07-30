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

/**
 * A run of values as a smooth path across a 0..100 box.
 *
 * Catmull-Rom through every point, converted to cubic beziers: a polyline of 24 buckets reads
 * as a saw even when the underlying rate is steady, and the shape is the only thing a line
 * this size is for. The curve still passes through every point, so no peak is smoothed away.
 */
function smoothPath(values: number[], max: number): string {
  if (values.length === 0) return ''
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
    y: 100 - (value / max) * 100,
  }))
  if (points.length === 1) return `M0,${points[0].y} L100,${points[0].y}`

  let path = `M${points[0].x},${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]
    const start = points[index]
    const end = points[index + 1]
    const next = points[index + 2] ?? points[index + 1]
    const firstX = start.x + (end.x - previous.x) / 6
    const firstY = start.y + (end.y - previous.y) / 6
    const secondX = end.x - (next.x - start.x) / 6
    const secondY = end.y - (next.y - start.y) / 6
    path += ` C${firstX},${firstY} ${secondX},${secondY} ${end.x},${end.y}`
  }
  return path
}

export interface TrendSeries {
  values: number[]
  color: string
}

/**
 * One or more runs of values as lines sharing a scale.
 *
 * Sharing the scale is the point when there are two: an average drawn against its own maximum
 * would sit at the same height as the p95 above it and hide how far apart they are.
 */
export function TrendLine({
  series,
  className = 'h-5 w-16',
}: {
  series: TrendSeries[]
  className?: string
}) {
  const max = Math.max(1, ...series.flatMap((line) => line.values))
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {series.map((line) => (
        <path
          key={line.color}
          d={smoothPath(line.values, max)}
          stroke={line.color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          // the box is stretched by preserveAspectRatio, and without this the stroke stretches too
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
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
