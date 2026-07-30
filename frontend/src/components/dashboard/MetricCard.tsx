import type { ReactNode } from 'react'
import { Panel } from '../ui/Panel'
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
 * The figure a chart is about, the series inside it, and the chart, in a well.
 *
 * No frame and no icon: the section around it already says which part of the app this belongs
 * to, and the header does all the labelling.
 */
export function MetricCard({ eyebrow, value, delta, upIsBad, breakdown, children }: MetricCardProps) {
  return (
    <Panel className="flex flex-col p-5">
      <MetricHeader label={eyebrow} value={value} series={breakdown} delta={delta} upIsBad={upIsBad} />
      {children && <div className="mt-5">{children}</div>}
    </Panel>
  )
}
