import { useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { barFill, barGlow } from '../lib/series'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

/** Column widths live here rather than in classes: the cursor has to convert a mouse position
 *  into a time, and that maths needs the same numbers the grid is laid out with. Exported
 *  because the cursor test has to do the same conversion, and a copy of the number there went
 *  stale the moment the label column grew. */
export const LABEL_W = 224
export const DURATION_W = 64
/** One level of nesting. Wide enough for the rail that draws it to be unmistakable. */
const INDENT = 14

const ZOOM_STEP = 1.6
const MAX_ZOOM = 20

export interface TimelineDot {
  key: string
  atMs: number
  color: string
  label: string
  /** Warning and above: the dot is lit, so where it went wrong is findable without reading. */
  lit?: boolean
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

/**
 * The rails that draw the nesting.
 *
 * Indentation alone is a convention the reader has to already know, and at 12px it was one
 * nobody could see: the whole point of a waterfall is which call happened inside which, and
 * that was the one thing this chart was not saying. One vertical rule per ancestor level, and
 * a stub into the row's own label — the same drawing a file tree uses, for the same reason.
 */
function DepthRails({ depth }: { depth: number }) {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${level * INDENT + 6}px` }}
        />
      ))}
      <span
        aria-hidden="true"
        className="absolute top-1/2 h-px bg-border"
        style={{ left: `${(depth - 1) * INDENT + 6}px`, width: `${INDENT - 2}px` }}
      />
    </>
  )
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
 *
 * A bar is drawn the way every other bar in the app is (lib/series barFill, and barGlow only
 * for the ones that failed), with a brighter cap at each end — because on a trace the two
 * questions are where this call started and where it ended, and a soft-edged translucent
 * sliver answered neither.
 */
export function SpanTimeline({ startMs, endMs, rows, maxHeightClass = 'max-h-80' }: SpanTimelineProps) {
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

      <div className={`rounded-well overflow-auto bg-surface-inset ${maxHeightClass}`}>
        <div
          data-testid="span-timeline"
          className="relative"
          style={{ width: `${zoom * 100}%`, minWidth: '100%' }}
          onMouseMove={(event) => setCursor(trackRatio(event))}
          onMouseLeave={() => setCursor(null)}
        >
          {/* axis: pinned so it stays readable while the rows scroll under it */}
          <div className="sticky top-0 z-20 grid h-6 bg-surface-inset" style={grid}>
            <span />
            <div className="relative">
              {ticks.map((ms) => (
                <span
                  key={ms}
                  className="tabular absolute top-0.5 -translate-x-1/2 text-[10px] whitespace-nowrap text-fg-subtle"
                  style={{ left: `${(ms / totalMs) * 100}%` }}
                >
                  {formatMs(ms)}
                </span>
              ))}
              <span className="absolute inset-x-0 bottom-0 h-px bg-border" aria-hidden="true" />
            </div>
            <span />
          </div>

          {rows.map((row) => (
            <div key={row.key} className="group grid items-center gap-x-2 hover:bg-white/[0.03]" style={grid}>
              <div
                className="relative sticky left-0 z-10 h-7 truncate bg-surface-inset pr-2 text-xs group-hover:bg-[#151b1d]"
                title={row.labelTitle}
              >
                <DepthRails depth={row.depth ?? 0} />
                <div
                  className="flex h-full items-center truncate"
                  style={{ paddingLeft: `${(row.depth ?? 0) * INDENT + (row.depth ? 8 : 0)}px` }}
                >
                  {row.onLabelClick ? (
                    <button
                      type="button"
                      onClick={row.onLabelClick}
                      className="max-w-full truncate text-left text-fg transition-colors hover:text-accent"
                    >
                      {row.label}
                    </button>
                  ) : (
                    <span className="block truncate text-fg">{row.label}</span>
                  )}
                </div>
              </div>

              <div className="relative h-7">
                {/* gridlines under the bars: they are what makes a zoomed axis readable */}
                {ticks.map((ms) => (
                  <span
                    key={ms}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-white/[0.04]"
                    style={{ left: `${(ms / totalMs) * 100}%` }}
                  />
                ))}
                {row.bar && row.bar.endMs > row.bar.startMs && (
                  <div
                    aria-hidden="true"
                    className="absolute top-2 h-3 rounded-[3px]"
                    style={{
                      left: `${percent(row.bar.startMs)}%`,
                      width: `${((row.bar.endMs - row.bar.startMs) / totalMs) * 100}%`,
                      minWidth: '2px',
                      background: barFill(
                        row.bar.error ? 'var(--color-level-error)' : 'var(--color-level-information)',
                      ),
                      boxShadow: row.bar.error ? barGlow('var(--color-level-error)') : undefined,
                    }}
                  >
                    {/* the two ends, drawn: where this call started and where it finished */}
                    <span className="absolute inset-y-0 left-0 w-0.5 rounded-l-[3px] bg-white/60" />
                    <span className="absolute inset-y-0 right-0 w-0.5 rounded-r-[3px] bg-white/40" />
                  </div>
                )}
                {row.dots.map((dot) => (
                  <button
                    key={dot.key}
                    type="button"
                    aria-label={dot.label}
                    title={dot.label}
                    onClick={dot.onClick}
                    className="absolute top-2 size-3 -translate-x-1/2 rounded-full ring-2 ring-[color:var(--color-bg)] transition-transform hover:scale-125"
                    style={{
                      left: `${percent(dot.atMs)}%`,
                      backgroundColor: dot.color,
                      boxShadow: dot.lit ? barGlow(dot.color) : undefined,
                    }}
                  />
                ))}
              </div>

              <span className="tabular sticky right-0 bg-surface-inset pr-1 text-right text-xs text-fg-muted group-hover:bg-[#151b1d]">
                {row.duration}
              </span>
            </div>
          ))}

          {cursor !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent shadow-[0_0_6px_0_var(--color-accent)]"
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
