import { useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

/** Column widths live here rather than in classes: the cursor has to convert a mouse position
 *  into a time, and that maths needs the same numbers the grid is laid out with. */
const LABEL_W = 176
const DURATION_W = 64

const ZOOM_STEP = 1.6
const MAX_ZOOM = 20

export interface TimelineDot {
  key: string
  atMs: number
  color: string
  label: string
  onClick: () => void
}

export interface TimelineRow {
  key: string
  label: ReactNode
  labelTitle?: string
  /** Present when the row opens something (a span's detail). */
  onLabelClick?: () => void
  depth?: number
  bar: { startMs: number; endMs: number; error: boolean } | null
  dots: TimelineDot[]
  /** Already formatted, because only the caller knows whether there is a duration at all. */
  duration: string
}

/** Ticks land on 1/2/5×10ⁿ so the labels stay round as the zoom changes. */
function buildTicks(totalMs: number, zoom: number): number[] {
  const target = Math.min(40, Math.max(4, Math.round(5 * zoom)))
  const raw = totalMs / target
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= raw)
  if (!step || step <= 0) return [0, totalMs]

  const ticks: number[] = []
  for (let ms = 0; ms <= totalMs && ticks.length <= 200; ms += step) {
    ticks.push(ms)
  }
  return ticks
}

/** No space, unlike the duration column: an axis tick and a row's duration must not read as the
 *  same kind of number, and the ticks have less room. */
function formatMs(ms: number): string {
  if (ms >= 100) return `${Math.round(ms)}ms`
  if (ms >= 10) return `${ms.toFixed(1)}ms`
  return `${ms.toFixed(2)}ms`
}

interface SpanTimelineProps {
  startMs: number
  endMs: number
  rows: TimelineRow[]
  /** Cap on the rows area; the axis stays pinned while they scroll. */
  maxHeightClass?: string
}

/**
 * The waterfall both trace modes draw on: a pinned time axis, one track per row, a zoom that
 * stretches the axis when spans are too short to tell apart, and a cursor that reads off the
 * offset under the pointer. Everything sits in one scroll box so the axis, the labels and the
 * durations cannot drift out of line with the bars.
 */
export function SpanTimeline({ startMs, endMs, rows, maxHeightClass = 'max-h-72' }: SpanTimelineProps) {
  const { t } = useI18n()
  const [zoom, setZoom] = useState(1)
  const [cursor, setCursor] = useState<number | null>(null)

  const totalMs = Math.max(1, endMs - startMs)
  const ticks = useMemo(() => buildTicks(totalMs, zoom), [totalMs, zoom])
  const grid = { gridTemplateColumns: `${LABEL_W}px 1fr ${DURATION_W}px` }
  const percent = (ms: number) => ((ms - startMs) / totalMs) * 100

  function trackRatio(event: MouseEvent<HTMLDivElement>): number | null {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = rect.width - LABEL_W - DURATION_W
    if (width <= 0) return null
    const ratio = (event.clientX - rect.left - LABEL_W) / width
    return ratio < 0 || ratio > 1 ? null : ratio
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-end gap-1">
        <span className="tabular mr-1 text-[10px] text-fg-subtle">{zoom.toFixed(1)}×</span>
        <Button
          variant="ghost"
          onClick={() => setZoom((current) => Math.max(1, current / ZOOM_STEP))}
          disabled={zoom <= 1}
          aria-label={t.trace.zoomOut}
          title={t.trace.zoomOut}
          className="px-2 py-0.5 text-xs"
        >
          −
        </Button>
        <Button
          variant="ghost"
          onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current * ZOOM_STEP))}
          disabled={zoom >= MAX_ZOOM}
          aria-label={t.trace.zoomIn}
          title={t.trace.zoomIn}
          className="px-2 py-0.5 text-xs"
        >
          +
        </Button>
        <Button
          variant="ghost"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
          aria-label={t.trace.zoomReset}
          title={t.trace.zoomReset}
          className="px-2 py-0.5 text-xs"
        >
          ⤢
        </Button>
      </div>

      <div className={`overflow-auto ${maxHeightClass}`}>
        <div
          data-testid="span-timeline"
          className="relative"
          style={{ width: `${zoom * 100}%`, minWidth: '100%' }}
          onMouseMove={(event) => setCursor(trackRatio(event))}
          onMouseLeave={() => setCursor(null)}
        >
          {/* axis: pinned so it stays readable while the rows scroll under it */}
          <div className="sticky top-0 z-20 grid h-5 bg-surface" style={grid}>
            <span />
            <div className="relative">
              {ticks.map((ms) => (
                <span
                  key={ms}
                  className="tabular absolute top-0 -translate-x-1/2 text-[10px] whitespace-nowrap text-fg-subtle"
                  style={{ left: `${(ms / totalMs) * 100}%` }}
                >
                  {formatMs(ms)}
                </span>
              ))}
            </div>
            <span />
          </div>

          {rows.map((row) => (
            <div key={row.key} className="grid items-center gap-x-2" style={grid}>
              <div
                className="sticky left-0 z-10 truncate bg-surface pr-2 text-xs"
                style={{ paddingLeft: `${(row.depth ?? 0) * 12}px` }}
                title={row.labelTitle}
              >
                {row.onLabelClick ? (
                  <button
                    type="button"
                    onClick={row.onLabelClick}
                    className="max-w-full truncate text-left text-fg hover:text-accent"
                  >
                    {row.label}
                  </button>
                ) : (
                  <span className="block truncate text-fg">{row.label}</span>
                )}
              </div>

              <div className="relative h-5">
                {/* gridlines under the bars: they are what makes a zoomed axis readable */}
                {ticks.map((ms) => (
                  <span
                    key={ms}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-border/60"
                    style={{ left: `${(ms / totalMs) * 100}%` }}
                  />
                ))}
                {row.bar && row.bar.endMs > row.bar.startMs && (
                  <div
                    aria-hidden="true"
                    className="absolute top-1.5 h-2 rounded-sm opacity-40"
                    style={{
                      left: `${percent(row.bar.startMs)}%`,
                      width: `${((row.bar.endMs - row.bar.startMs) / totalMs) * 100}%`,
                      backgroundColor: row.bar.error ? 'var(--color-level-error)' : 'var(--color-level-information)',
                    }}
                  />
                )}
                {row.dots.map((dot) => (
                  <button
                    key={dot.key}
                    type="button"
                    aria-label={dot.label}
                    title={dot.label}
                    onClick={dot.onClick}
                    className="absolute top-1 size-3 -translate-x-1/2 rounded-full border border-bg"
                    style={{ left: `${percent(dot.atMs)}%`, backgroundColor: dot.color }}
                  />
                ))}
              </div>

              <span className="tabular sticky right-0 bg-surface text-right text-xs text-fg-muted">
                {row.duration}
              </span>
            </div>
          ))}

          {cursor !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent"
              style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W + DURATION_W}px) * ${cursor})` }}
            >
              <span className="tabular absolute top-0 -translate-x-1/2 rounded bg-accent px-1 py-px text-[10px] font-medium text-accent-fg">
                {formatMs(cursor * totalMs)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
