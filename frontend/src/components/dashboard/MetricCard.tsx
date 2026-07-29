import type { ReactNode } from 'react'
import { Card } from '../ui/Card'
import { PageIcon } from '../icons'
import type { PageIconName } from '../icons'

export interface MetricBreakdown {
  label: string
  value: string
  /** A raw colour (LEVEL_HEX value) for the leading dot; omit for no dot. */
  color?: string
  tone?: 'default' | 'error' | 'warning'
}

const TONE_CLASS = {
  default: 'text-fg',
  error: 'text-level-error',
  warning: 'text-level-warning',
} as const

/** Tint for the icon plate: the neutral figure carries the accent, error counts carry theirs. */
const PLATE_CLASS = {
  accent: 'bg-accent/12 text-accent',
  error: 'bg-level-error/12 text-level-error',
} as const

interface MetricCardProps {
  eyebrow: string
  value: string
  /** Small tinted plate left of the eyebrow, naming what the figure counts. */
  icon?: PageIconName
  plate?: keyof typeof PLATE_CLASS
  /** Right-aligned secondary figures, each shown as a small labelled column (the colour key). */
  breakdown?: MetricBreakdown[]
  /** The chart that fills the body. */
  children?: ReactNode
}

/** The dashboard's signature card: an eyebrow label, one big figure, a right-aligned
 *  breakdown that doubles as the chart's colour key, and a chart below. */
export function MetricCard({ eyebrow, value, icon, plate = 'accent', breakdown, children }: MetricCardProps) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium tracking-wider text-fg-muted uppercase">
            {icon && (
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-md ${PLATE_CLASS[plate]}`}
                aria-hidden="true"
              >
                <PageIcon name={icon} className="size-3.5" />
              </span>
            )}
            {eyebrow}
          </p>
          <p className="tabular mt-1.5 text-3xl font-semibold text-fg">{value}</p>
        </div>
        {breakdown && breakdown.length > 0 && (
          <div className="flex shrink-0 items-start gap-5">
            {breakdown.map((item) => (
              <div key={item.label} className="text-right">
                <p className="flex items-center justify-end gap-1.5 text-[0.65rem] font-medium uppercase tracking-wide text-fg-muted">
                  {item.color && <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />}
                  {item.label}
                </p>
                <p className={`tabular mt-0.5 text-sm font-semibold ${TONE_CLASS[item.tone ?? 'default']}`}>{item.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  )
}
