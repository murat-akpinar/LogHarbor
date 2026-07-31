import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { HistogramBucket } from '../types'
import { LEVELS, LEVEL_CHART, LEVEL_HEX, barSegments, sumLevels } from '../lib/levels'
import { formatTimestamp } from '../lib/dates'
import { plotMax, sweep } from '../lib/plotScale'
import { useI18n } from '../i18n'
import { Card } from './ui/Card'

const PLOT_HEIGHT_PX = 160

interface TooltipProps {
  bucket: HistogramBucket
}

function BucketTooltip({ bucket }: TooltipProps) {
  const { t, lang } = useI18n()
  const total = sumLevels(bucket.counts)
  return (
    <Card className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 p-2 text-xs">
      <p className="mb-1 text-fg-muted">{formatTimestamp(bucket.start, lang)}</p>
      {LEVELS.map((level) => (
        <div key={level} className="flex items-center gap-2 py-0.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: LEVEL_HEX[level] }} />
          <span className="tabular font-semibold text-fg">{bucket.counts[level]}</span>
          <span className="text-fg-muted">{level}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-border pt-1">
        <span className="text-fg-muted">{t.dashboard.total}</span>
        <span className="tabular font-semibold text-fg">{total}</span>
      </div>
    </Card>
  )
}

interface HistogramProps {
  buckets: HistogramBucket[]
  /** upper bound of the queried range; the last bucket's click target ends here. */
  rangeEnd: string
  onBucketClick: (start: string, end: string) => void
  /** Dragging across two or more bars zooms into that range; a plain click stays onBucketClick. */
  onBrush: (start: string, end: string) => void
  /** The per-level legend below the bars; hide it when a caller supplies its own colour key. */
  showLegend?: boolean
}

export function Histogram({ buckets, rangeEnd, onBucketClick, onBrush, showLegend = true }: HistogramProps) {
  const { t, lang } = useI18n()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ anchor: number; head: number } | null>(null)

  useEffect(() => {
    if (!drag) return
    const { anchor, head } = drag
    function commit() {
      setDrag(null)
      // a same-bar release is a plain click; the button's onClick handles it
      if (anchor === head) return
      const low = Math.min(anchor, head)
      const high = Math.max(anchor, head)
      onBrush(buckets[low].start, buckets[high + 1]?.start ?? rangeEnd)
    }
    window.addEventListener('mouseup', commit)
    return () => window.removeEventListener('mouseup', commit)
  }, [drag, buckets, rangeEnd, onBrush])

  function isBrushed(index: number): boolean {
    return drag !== null && index >= Math.min(drag.anchor, drag.head) && index <= Math.max(drag.anchor, drag.head)
  }

  const max = plotMax(buckets.map((bucket) => sumLevels(bucket.counts)))

  return (
    <div>
      <div className="flex min-w-0 items-end gap-[2px]" style={{ height: PLOT_HEIGHT_PX }}>
        {buckets.map((bucket, index) => {
            const total = sumLevels(bucket.counts)
            const segments = barSegments(bucket.counts)
            return (
              // keyed by position rather than by timestamp: live mode moves the window every ten
              // seconds, and keying on the start would remount every bar and replay its entrance
              <button
                key={index}
                type="button"
                onClick={() => onBucketClick(bucket.start, buckets[index + 1]?.start ?? rangeEnd)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  setDrag({ anchor: index, head: index })
                }}
                onMouseEnter={() => {
                  setHoveredIndex(index)
                  setDrag((current) => (current ? { ...current, head: index } : null))
                }}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
                className="group animate-grow relative flex h-full min-w-0 flex-1 flex-col-reverse select-none"
                style={{ '--delay': `${sweep(index, buckets.length)}ms` } as CSSProperties}
                aria-label={t.dashboard.bucketAria(formatTimestamp(bucket.start, lang), total)}
              >
                <span
                  className={`absolute inset-0 -m-px rounded-sm ${
                    isBrushed(index) ? 'bg-accent/20' : 'group-hover:bg-surface-hover'
                  }`}
                />
                {segments.map((segment, segmentIndex) => (
                  <span
                    key={segment.key}
                    className={`relative w-full shrink-0 transition-[height] duration-500 ${
                      segmentIndex === segments.length - 1 ? 'rounded-t-[2px]' : ''
                    }`}
                    style={{ height: `${(segment.count / max) * 100}%`, minHeight: '1px', backgroundColor: segment.color }}
                  />
                ))}
                {hoveredIndex === index && <BucketTooltip bucket={bucket} />}
              </button>
            )
          })}
      </div>

      {/* No axis and no per-bucket ticks: the window's two ends are the only labels a reader
          needs to place a bar, and the exact numbers are already one hover away. */}
      {buckets.length > 0 && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-xs text-fg-subtle">
          <span>{formatTimestamp(buckets[0].start, lang)}</span>
          <span>{formatTimestamp(rangeEnd, lang)}</span>
        </div>
      )}

      {showLegend && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {LEVELS.map((level) => (
            <div key={level} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_CHART[level] }} />
              <span>{level}</span>
              <span className="tabular">
                ({buckets.reduce((total, bucket) => total + bucket.counts[level], 0).toLocaleString(lang)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
