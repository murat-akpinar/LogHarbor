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
 * say it. It is drawn in the series' own colour and washed underneath, because at this size a
 * hairline of grey is a smudge — the colour is what makes the shape legible in a 20px strip.
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
  return (
    <Panel
      className="animate-rise px-4 py-3"
      style={{ '--delay': `${index * 60}ms` } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase">
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
        {trend && trend.length > 0 && (
          <TrendLine
            series={[{ values: trend, color: trendColor ?? 'var(--color-accent)' }]}
            className="h-7 w-24 shrink-0"
            fill
          />
        )}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold text-fg">{value}</p>
      <Delta value={delta} upIsBad={upIsBad} className="mt-1" />
    </Panel>
  )
}
