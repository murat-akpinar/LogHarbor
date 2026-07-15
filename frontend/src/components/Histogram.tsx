import { useEffect, useState } from 'react'
import type { HistogramBucket, Level } from '../types'
import { LEVELS, LEVEL_HEX } from '../lib/levels'
import { formatTimestamp } from '../lib/dates'
import { niceCeil } from '../lib/niceScale'
import { Card } from './ui/Card'

const PLOT_HEIGHT_PX = 160

function sumCounts(counts: Record<Level, number>): number {
  return LEVELS.reduce((total, level) => total + counts[level], 0)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

interface TooltipProps {
  bucket: HistogramBucket
}

function BucketTooltip({ bucket }: TooltipProps) {
  const total = sumCounts(bucket.counts)
  return (
    <Card className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 p-2 text-xs">
      <p className="mb-1 text-fg-muted">{formatTimestamp(bucket.start)}</p>
      {LEVELS.map((level) => (
        <div key={level} className="flex items-center gap-2 py-0.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: LEVEL_HEX[level] }} />
          <span className="tabular font-semibold text-fg">{bucket.counts[level]}</span>
          <span className="text-fg-muted">{level}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-border pt-1">
        <span className="text-fg-muted">Total</span>
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
}

export function Histogram({ buckets, rangeEnd, onBucketClick, onBrush }: HistogramProps) {
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

  const niceMax = niceCeil(Math.max(1, ...buckets.map((bucket) => sumCounts(bucket.counts))))
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6))

  return (
    <div>
      <div className="flex gap-2">
        <div
          className="flex w-10 shrink-0 flex-col justify-between text-right text-xs text-fg-muted"
          style={{ height: PLOT_HEIGHT_PX }}
        >
          <span className="tabular">{niceMax.toLocaleString()}</span>
          <span className="tabular">0</span>
        </div>
        <div
          className="flex min-w-0 flex-1 items-end gap-0.5 border-b border-border"
          style={{ height: PLOT_HEIGHT_PX }}
        >
          {buckets.map((bucket, index) => {
            const total = sumCounts(bucket.counts)
            return (
              <button
                key={bucket.start}
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
                className="group relative flex h-full min-w-0 flex-1 flex-col-reverse gap-0.5 select-none"
                aria-label={`${formatTimestamp(bucket.start)}: ${total} events`}
              >
                <span
                  className={`absolute inset-0 -m-px rounded-sm ${
                    isBrushed(index) ? 'bg-accent/20' : 'group-hover:bg-surface-hover'
                  }`}
                />
                {LEVELS.map((level) => {
                  const heightPct = (bucket.counts[level] / niceMax) * 100
                  return heightPct > 0 ? (
                    <span
                      key={level}
                      className="relative w-full shrink-0 rounded-sm"
                      style={{ height: `${heightPct}%`, backgroundColor: LEVEL_HEX[level] }}
                    />
                  ) : null
                })}
                {hoveredIndex === index && <BucketTooltip bucket={bucket} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* mirrors the bars row's flex layout exactly so each label sits under its bucket */}
      <div className="ml-12 flex gap-0.5">
        {buckets.map((bucket, index) => (
          <span key={bucket.start} className="min-w-0 flex-1 truncate text-center text-xs text-fg-muted">
            {index % labelEvery === 0 ? formatTime(bucket.start) : ''}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {LEVELS.map((level) => (
          <div key={level} className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_HEX[level] }} />
            <span>{level}</span>
            <span className="tabular">
              ({buckets.reduce((total, bucket) => total + bucket.counts[level], 0).toLocaleString()})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
