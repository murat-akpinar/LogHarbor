import { useId } from 'react'
import type { CSSProperties } from 'react'
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
          className="animate-grow min-w-0 flex-1 rounded-t-[1px]"
          // 8% floor keeps single events visible next to the peak bucket
          style={
            {
              height: total > 0 ? `${Math.max(8, (total / max) * 100)}%` : '0%',
              backgroundColor: color,
              '--delay': `${index * 8}ms`,
            } as CSSProperties
          }
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
function smoothPath(values: number[], max: number, centered: boolean): string {
  const points = plotPoints(values, max, centered)
  if (points.length === 0) return ''
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

function plotPoints(values: number[], max: number, centered: boolean) {
  return values.map((value, index) => ({
    x: centered
      ? ((index + 0.5) / values.length) * 100
      : values.length === 1
        ? 50
        : (index / (values.length - 1)) * 100,
    y: 100 - (value / max) * 100,
  }))
}

/** The same curve, closed down to the floor so it can be filled. */
function areaPath(values: number[], max: number, centered: boolean): string {
  const line = smoothPath(values, max, centered)
  if (!line) return ''
  const points = plotPoints(values, max, centered)
  const first = points.length === 1 ? 0 : points[0].x
  const last = points.length === 1 ? 100 : points[points.length - 1].x
  return `${line} L${last},100 L${first},100 Z`
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
  centered = false,
  fill = false,
  animate = true,
}: {
  series: TrendSeries[]
  className?: string
  /** Puts each point over its bucket's centre instead of spanning edge to edge — what a line
   *  drawn over bucketed bars needs, so a peak in the line sits on the bar that caused it. */
  centered?: boolean
  /** Washes the area under each line in its own colour, for a line that has to hold a lane of
   *  its own between two sets of bars. A sparkline in a tile stays a stroke. */
  fill?: boolean
  /** The line draws itself in on mount. Off for anything that redraws often enough that the
   *  drawing would be the only thing you ever see. */
  animate?: boolean
}) {
  const max = Math.max(1, ...series.flatMap((line) => line.values))
  // one id per instance, because a page holds a dozen of these and a gradient is referenced by id
  const gradientId = useId()

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {fill && (
        <defs>
          {series.map((line, index) => (
            // the wash fades out downward instead of sitting as a flat block of colour: it says
            // "this line has weight under it" without competing with the bars in the next lane
            <linearGradient key={`grad-${index}`} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={line.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
      )}
      {fill &&
        series.map((line, index) => (
          <path
            key={`fill-${line.color}`}
            d={areaPath(line.values, max, centered)}
            fill={`url(#${gradientId}-${index})`}
            className={animate ? 'animate-wash' : ''}
          />
        ))}
      {series.map((line) => (
        <path
          key={line.color}
          d={smoothPath(line.values, max, centered)}
          stroke={line.color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          // the box is stretched by preserveAspectRatio, and without this the stroke stretches too
          vectorEffect="non-scaling-stroke"
          // pathLength normalizes the curve to 1 unit, so one dash covers the whole of it
          // whatever its real length — no measuring the DOM to animate the draw
          pathLength={animate ? 1 : undefined}
          className={animate ? 'animate-draw' : ''}
          style={animate ? ({ '--length': 1 } as CSSProperties) : undefined}
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
