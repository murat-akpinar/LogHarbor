import { Fragment } from 'react'
import type { CSSProperties } from 'react'
import type { HeatmapCell } from '../types'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

// sequential ramp: accent (quiet) -> warning -> error (busiest), so a glance at the hue alone
// tells you how hot an hour is. sqrt keeps sparse cells visibly distinct from empty next to a
// dominant peak.
function cellColor(count: number, max: number): string {
  // an hour that recorded nothing is a hole in the plate, not a pale version of a busy hour
  if (count <= 0) return 'rgb(255 255 255 / 0.035)'
  const intensity = Math.sqrt(count / max)
  if (intensity <= 0.5) {
    const pct = Math.round((intensity / 0.5) * 100)
    return `color-mix(in oklab, ${LEVEL_HEX.Warning} ${pct}%, var(--color-accent))`
  }
  const pct = Math.round(((intensity - 0.5) / 0.5) * 100)
  return `color-mix(in oklab, ${LEVEL_HEX.Error} ${pct}%, ${LEVEL_HEX.Warning})`
}

/**
 * The bloom on a busy cell, and nothing at all below two thirds of the peak.
 *
 * A grid where every cell glows is a grid where none of them does, which is the same reason
 * only Warning and above light up a bar (barGlow in lib/series).
 */
function cellGlow(count: number, max: number): string | undefined {
  const intensity = count > 0 ? Math.sqrt(count / max) : 0
  if (intensity < 0.66) return undefined
  return `0 0 ${Math.round(intensity * 10)}px -1px ${cellColor(count, max)}`
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
              // the grid fills in on the diagonal, so the week arrives as a wash across the
              // plate rather than 168 cells appearing at once
              <div
                key={hour}
                role="img"
                aria-label={label}
                title={label}
                className="animate-rise h-4 rounded-sm transition-colors duration-500 hover:ring-1 hover:ring-white/30"
                style={
                  {
                    backgroundColor: cellColor(count, max),
                    // the busiest hours are lit, the same way an alert bar is: the week's peak
                    // is findable without hunting for the darkest red
                    boxShadow: cellGlow(count, max),
                    '--delay': `${(dayOfWeek + hour) * 12}ms`,
                  } as CSSProperties
                }
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
