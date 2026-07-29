import { useI18n } from '../i18n'
import { PageIcon } from './icons'
import type { PageIconName } from './icons'
import { TrendBars } from './Sparkline'
import { Card } from './ui/Card'

const PLATE_CLASS = {
  accent: 'bg-accent/12 text-accent',
  error: 'bg-level-error/12 text-level-error',
  warning: 'bg-level-warning/12 text-level-warning',
  info: 'bg-level-information/12 text-level-information',
} as const

interface StatTileProps {
  label: string
  /** Already formatted: the tile does not know whether it holds events, seconds or a count. */
  value: string
  icon?: PageIconName
  plate?: keyof typeof PLATE_CLASS
  /** Per-bucket totals for the mini trend. Omitted when the figure has no shape over time. */
  trend?: number[]
  trendColor?: string
  /** Percent change against the previous window of equal length; null when there is nothing to
   *  compare against, which is not the same as no change. */
  delta?: number | null
  /** For counts where more is worse (errors), so the arrow's colour tells the truth. */
  upIsBad?: boolean
}

/** Rounds for display and keeps a runaway ratio from filling the tile. */
function formatDelta(delta: number): string {
  const magnitude = Math.abs(delta)
  if (magnitude > 999) return '>999%'
  return `${magnitude.toFixed(magnitude < 10 ? 1 : 0)}%`
}

/**
 * One glanceable figure: what it is, what it reads now, and whether that is more or less than the
 * window before it. The comparison is the reason the tile exists — a number with nothing to
 * measure it against is something the panels below already show.
 */
export function StatTile({ label, value, icon, plate = 'accent', trend, trendColor, delta, upIsBad }: StatTileProps) {
  const { t } = useI18n()
  // a drop in volume is not automatically good news, so only the direction that is clearly
  // meaningful gets a colour; the other stays neutral rather than inventing a judgement
  const deltaClass =
    delta === undefined || delta === null || delta === 0
      ? 'text-fg-subtle'
      : delta > 0
        ? upIsBad
          ? 'text-level-error'
          : 'text-accent'
        : upIsBad
          ? 'text-accent'
          : 'text-fg-muted'

  return (
    <Card className="px-4 py-3">
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
          <TrendBars values={trend} color={trendColor ?? 'var(--color-accent)'} className="h-5 w-16 shrink-0" />
        )}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold text-fg">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={`tabular mt-1 text-xs ${deltaClass}`}>
          {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'} {formatDelta(delta)}{' '}
          <span className="text-fg-subtle">{t.dashboard.vsPrevious}</span>
        </p>
      )}
    </Card>
  )
}
