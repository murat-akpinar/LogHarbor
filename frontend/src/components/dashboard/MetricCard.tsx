import type { ReactNode } from 'react'
import { Card } from '../ui/Card'
import { MetricHeader } from '../ui/MetricHeader'
import type { MetricSeries } from '../ui/MetricHeader'

interface MetricCardProps {
  eyebrow: string
  value: string
  /** Percent change against the previous window; null when there was nothing to compare against. */
  delta?: number | null
  upIsBad?: boolean
  /** Right-aligned secondary figures, each its own labelled column and the chart's colour key. */
  breakdown?: MetricSeries[]
  /** The chart that fills the body. */
  children?: ReactNode
}

/**
 * The dashboard's signature card: the figure the chart is about, the series inside it, and the
 * chart. The header does all the labelling, which is why the card carries no icon of its own —
 * the section above it already says which part of the app this belongs to.
 */
export function MetricCard({ eyebrow, value, delta, upIsBad, breakdown, children }: MetricCardProps) {
  return (
    <Card className="flex flex-col p-4">
      <MetricHeader label={eyebrow} value={value} series={breakdown} delta={delta} upIsBad={upIsBad} />
      {children && <div className="mt-4">{children}</div>}
    </Card>
  )
}
