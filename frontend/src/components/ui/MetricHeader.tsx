import { Delta } from './Delta'

export interface MetricSeries {
  label: string
  /** Already formatted: the header does not know whether it holds events, bytes or milliseconds. */
  value: string
  /** CSS colour for the swatch. Omitted means the figure is not a series in the chart below,
   *  so it gets no swatch — a rate or a ratio sits here without pretending to be a colour key. */
  color?: string
}

/**
 * The figure a chart is about, and the series inside it, above the plot.
 *
 * The legend is the readout: each series carries its own number, which is why a chart built
 * this way needs no separate row of stat tiles repeating what it already says. The left-hand
 * figure is the whole; the right-hand columns are what it is made of.
 */
export function MetricHeader({
  label,
  value,
  series = [],
  delta,
  upIsBad,
}: {
  label: string
  value: string
  series?: MetricSeries[]
  delta?: number | null
  upIsBad?: boolean
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-[0.12em] text-fg-muted uppercase">{label}</p>
        <p className="tabular mt-1 text-2xl font-semibold text-fg">{value}</p>
        <Delta value={delta} upIsBad={upIsBad} className="mt-0.5" />
      </div>

      {series.length > 0 && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          {series.map((entry) => (
            <div key={entry.label} className="min-w-0 text-right">
              <p className="flex items-center justify-end gap-1.5 text-xs tracking-wider text-fg-muted uppercase">
                {entry.color && (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: entry.color }}
                  />
                )}
                <span className="truncate">{entry.label}</span>
              </p>
              <p className="tabular mt-1 text-xl font-semibold text-fg">{entry.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
