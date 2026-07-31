import type { CSSProperties } from 'react'
import { PageIcon } from './icons'
import type { PageIconName } from './icons'
import { TrendLine } from './Sparkline'
import { Panel } from './ui/Panel'
import { Delta } from './ui/Delta'

const PLATE_CLASS = {
  accent: 'bg-accent/12 text-accent ring-1 ring-accent/20',
  error: 'bg-level-error/12 text-level-error ring-1 ring-level-error/20',
  warning: 'bg-level-warning/12 text-level-warning ring-1 ring-level-warning/20',
  info: 'bg-level-information/12 text-level-information ring-1 ring-level-information/20',
} as const

/**
 * How much of the tile the shape occupies along its floor, and the bottom padding that keeps
 * the text off it. The two have to be the same number: the shape is absolutely positioned, so
 * nothing reflows around it, and a floor taller than the padding runs straight under the delta.
 */
const TREND_HEIGHT = 'h-11'
const TREND_CLEARANCE = 'pb-11'

interface StatTileProps {
  label: string
  /** Already formatted: the tile does not know whether it holds events, seconds or a count. */
  value: string
  icon?: PageIconName
  plate?: keyof typeof PLATE_CLASS
  /** The figure's shape over the same window, drawn as a line. Omitted when it has none. */
  trend?: number[]
  trendColor?: string
  /** Percent change against the previous window of equal length. */
  delta?: number | null
  /** For counts where more is worse (errors), so the arrow's colour tells the truth. */
  upIsBad?: boolean
  /** Position in the band: the tiles arrive left to right rather than all at once. */
  index?: number
}

/**
 * One glanceable figure: what it is, what it reads now, the shape it took getting there, and
 * whether that is more or less than the window before it.
 *
 * The line matters as much as the number. A p95 of 240ms means nothing on its own; a p95 of
 * 240ms that has been climbing all hour is the thing worth knowing, and no single figure can
 * say it. So the shape is not an ornament tucked in a corner at 20px — it is the floor of the
 * tile, full width, edge to edge, drawn in the series' own colour with the wash under it. The
 * number sits above its own history rather than beside a thumbnail of it.
 *
 * The hairline along the top edge carries the same colour, which is what makes five tiles in a
 * row read as five different measurements instead of five copies of one card.
 */
export function StatTile({
  label,
  value,
  icon,
  plate = 'accent',
  trend,
  trendColor,
  delta,
  upIsBad,
  index = 0,
}: StatTileProps) {
  const color = trendColor ?? 'var(--color-accent)'
  const hasTrend = trend !== undefined && trend.length > 0

  return (
    <Panel
      className={`animate-rise relative overflow-hidden px-4 pt-3 ${hasTrend ? TREND_CLEARANCE : 'pb-4'}`}
      style={{ '--delay': `${index * 60}ms` } as CSSProperties}
    >
      {/* drawn even for a figure that has no shape, so a tile without one still belongs to the
          band rather than reading as an empty card that wandered in */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, ${color}, transparent 70%)` }}
        aria-hidden="true"
      />

      <p className="relative flex min-w-0 items-center gap-2 text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase">
        {icon && (
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-md ${PLATE_CLASS[plate]}`}
            aria-hidden="true"
          >
            <PageIcon name={icon} className="size-3.5" />
          </span>
        )}
        <span className="truncate">{label}</span>
      </p>

      <div className="relative mt-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="tabular text-2xl font-semibold text-fg">{value}</p>
        <Delta value={delta} upIsBad={upIsBad} />
      </div>

      {/* full bleed, so the shape is the tile's floor rather than a thumbnail parked in a corner */}
      {hasTrend && (
        <TrendLine
          series={[{ values: trend, color }]}
          className={`pointer-events-none absolute inset-x-0 bottom-0 w-full ${TREND_HEIGHT}`}
          fill
        />
      )}
    </Panel>
  )
}
