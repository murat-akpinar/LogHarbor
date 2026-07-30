import { useI18n } from '../../i18n'

/** Rounds for display and keeps a runaway ratio from filling the line. */
function format(delta: number): string {
  const magnitude = Math.abs(delta)
  if (magnitude > 999) return '>999%'
  return `${magnitude.toFixed(magnitude < 10 ? 1 : 0)}%`
}

/**
 * Percent change against the previous window of equal length.
 *
 * A drop in volume is not automatically good news, so only the direction that is clearly
 * meaningful gets a colour; the other stays neutral rather than inventing a judgement.
 * Renders nothing when there is nothing to compare against, which is not the same as no change.
 */
export function Delta({
  value,
  upIsBad = false,
  className = '',
}: {
  value: number | null | undefined
  /** For counts where more is worse (errors), so the arrow's colour tells the truth. */
  upIsBad?: boolean
  className?: string
}) {
  const { t } = useI18n()
  if (value === undefined || value === null) return null

  const tone =
    value === 0
      ? 'text-fg-subtle'
      : value > 0
        ? upIsBad
          ? 'text-level-error'
          : 'text-accent'
        : upIsBad
          ? 'text-accent'
          : 'text-fg-muted'

  return (
    <p className={`tabular text-xs ${tone} ${className}`}>
      {value > 0 ? '↑' : value < 0 ? '↓' : '·'} {format(value)}{' '}
      <span className="text-fg-subtle">{t.dashboard.vsPrevious}</span>
    </p>
  )
}
