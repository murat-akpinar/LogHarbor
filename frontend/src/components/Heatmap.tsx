import { Fragment } from 'react'
import type { HeatmapCell } from '../types'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

// sequential ramp: accent (quiet) -> warning -> error (busiest), so a glance at the hue alone
// tells you how hot an hour is. sqrt keeps sparse cells visibly distinct from empty next to a
// dominant peak.
function cellColor(count: number, max: number): string {
  if (count <= 0) return 'var(--color-surface-hover)'
  const intensity = Math.sqrt(count / max)
  if (intensity <= 0.5) {
    const pct = Math.round((intensity / 0.5) * 100)
    return `color-mix(in oklab, ${LEVEL_HEX.Warning} ${pct}%, var(--color-accent))`
  }
  const pct = Math.round(((intensity - 0.5) / 0.5) * 100)
  return `color-mix(in oklab, ${LEVEL_HEX.Error} ${pct}%, ${LEVEL_HEX.Warning})`
}

interface HeatmapProps {
  cells: HeatmapCell[]
}

export function Heatmap({ cells }: HeatmapProps) {
  const { t, lang } = useI18n()
  const counts = new Map(cells.map((cell) => [cell.dayOfWeek * 24 + cell.hour, cell.count]))
  const max = Math.max(1, ...cells.map((cell) => cell.count))

  return (
    <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-0.5">
      {t.dashboard.dayLabels.map((day, dayOfWeek) => (
        <Fragment key={day}>
          <span className="pr-2 text-right text-xs leading-4 text-fg-muted">{day}</span>
          {HOURS.map((hour) => {
            const count = counts.get(dayOfWeek * 24 + hour) ?? 0
            const label = t.dashboard.cellAria(day, String(hour).padStart(2, '0'), count.toLocaleString(lang))
            return (
              <div
                key={hour}
                role="img"
                aria-label={label}
                title={label}
                className="h-4 rounded-sm"
                style={{ backgroundColor: cellColor(count, max) }}
              />
            )
          })}
        </Fragment>
      ))}
      <span />
      {HOURS.map((hour) => (
        <span key={hour} className="text-center text-xs text-fg-muted">
          {hour % 3 === 0 ? hour : ''}
        </span>
      ))}
    </div>
  )
}
