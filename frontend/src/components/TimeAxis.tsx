import { useEffect, useRef, useState } from 'react'
import { axisTicks } from '../lib/timeAxis'
import { useI18n } from '../i18n'

/** Roughly how much room one label needs before its neighbour starts crowding it. */
const LABEL_WIDTH_PX = 78

/**
 * The time axis under a plot: a rule, a tick per round boundary, and its label.
 *
 * How many labels fit is a question about pixels, not about data, so the strip measures itself
 * and asks for that many. The same chart at 1600px gets ticks every ten minutes and at 420px
 * every half hour, instead of a fixed count that is sparse on one and illegible on the other.
 *
 * Still no gridlines and still no y-axis. A line up the plot would have to cross three lanes of
 * bars to reach the reader, and the bars are the thing being read.
 */
export function TimeAxis({ from, to, className = '' }: { from: string; to: string; className?: string }) {
  const { lang } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()

    // ResizeObserver rather than a window listener where it exists: the card sits in a grid
    // that reflows for reasons the window never hears about — a lane's chips wrapping, the
    // detail drawer opening beside the stream. It is absent in jsdom, and an axis is not worth
    // a polyfill in the test setup, so the window listener is the fallback.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ticks = width > 0 ? axisTicks(from, to, Math.max(2, Math.floor(width / LABEL_WIDTH_PX)), lang) : []

  return (
    <div ref={ref} data-testid="time-axis" className={`relative h-8 select-none ${className}`} aria-hidden="true">
      <span className="absolute inset-x-0 top-0 h-px bg-border" />
      {ticks.map((tick) => (
        <span
          key={tick.position}
          className="absolute top-0 flex flex-col items-center"
          style={{
            left: `${tick.position * 100}%`,
            // the end labels would hang off the plot; they pull themselves back inside instead
            transform:
              tick.position < 0.02 ? 'none' : tick.position > 0.98 ? 'translateX(-100%)' : 'translateX(-50%)',
          }}
        >
          <span className={`h-1.5 w-px ${tick.isDay ? 'bg-border-strong' : 'bg-border'}`} />
          {/* a day boundary is set brighter: on a week-long window it is the only label that
              tells you where you are, and it has to win against twenty clock times */}
          <span
            className={`tabular mt-1 font-mono text-[0.625rem] whitespace-nowrap ${
              tick.isDay ? 'font-semibold text-fg-muted' : 'text-fg-subtle'
            }`}
          >
            {tick.label}
          </span>
        </span>
      ))}
    </div>
  )
}
