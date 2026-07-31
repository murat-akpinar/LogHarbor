import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { HistogramBucket, LatencyOverview, Level } from '../../types'
import { useHistogram } from '../../hooks/useStats'
import { ALERT_LEVELS, LEVEL_CHART, LEVEL_HEX, QUIET_LEVELS, barSegments, sumLevels } from '../../lib/levels'
import { STATUS_FILTERS, STATUS_SERIES } from '../../lib/status'
import type { StatusClass } from '../../lib/status'
import { formatTimestamp } from '../../lib/dates'
import { formatDuration } from '../../lib/duration'
import { niceCeil } from '../../lib/niceScale'
import { useI18n } from '../../i18n'
import { Card } from '../ui/Card'
import { Panel } from '../ui/Panel'
import { PillLink } from '../ui/PillLink'
import { SeriesChip } from '../ui/SeriesChip'
import { TrendLine } from '../Sparkline'

/** The timeline's resolution. Callers fetch their own series at this width so every lane lands
 *  on the same columns — one hour of columns thin enough to read as ticks rather than slabs. */
export const TIMELINE_BUCKETS = 60

const VOLUME_HEIGHT_PX = 148
const DURATION_HEIGHT_PX = 64
const STATUS_HEIGHT_PX = 52

/**
 * Nulls carried as the last known reading.
 *
 * A bucket where nothing was timed is "no measurement", and drawing it at zero would read as
 * "it got fast" — the one thing a latency line must never say by accident.
 */
function carryGaps(values: (number | null)[]): number[] {
  let last = values.find((value) => value !== null) ?? 0
  return values.map((value) => {
    if (value !== null) last = value
    return last
  })
}

interface LaneProps {
  label: string
  /** The lane's colour key, which is also its readout. */
  chips: ReactNode
  action?: ReactNode
  children: ReactNode
}

/** One row of the timeline: what it measures, its series, and the plot itself. */
function Lane({ label, chips, action, children }: LaneProps) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="flex min-w-0 items-center gap-2 text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase">
          <span className="truncate">{label}</span>
          {action}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      </div>
      {children}
    </div>
  )
}

type LaneName = 'volume' | 'duration' | 'status'

interface ColumnsProps {
  count: number
  hovered: number | null
  isBrushed: (index: number) => boolean
  onHover: (index: number | null) => void
  onPress: (index: number) => void
  /** Only the volume lane takes clicks and focus; the lanes below it follow the same hover. */
  onClick?: (index: number) => void
  columnLabel?: (index: number) => string
}

/**
 * The hit area, one transparent column per bucket, laid over a lane's plot.
 *
 * Every lane gets one and they all report into the same hovered index, which is what makes
 * three plots read as one timeline: pointing at a latency spike lights the column that holds
 * the errors that came with it.
 */
function Columns({ count, hovered, isBrushed, onHover, onPress, onClick, columnLabel }: ColumnsProps) {
  return (
    <div className="absolute inset-0 flex gap-[2px]">
      {Array.from({ length: count }, (_, index) => {
        const handlers = {
          onMouseEnter: () => onHover(index),
          onMouseLeave: () => onHover(null),
          onMouseDown: (event: { preventDefault: () => void }) => {
            event.preventDefault()
            onPress(index)
          },
          className: 'relative min-w-0 flex-1 select-none',
          children: (
            <>
              <span
                className={`absolute inset-0 -m-px rounded-sm ${
                  isBrushed(index) ? 'bg-accent/20' : hovered === index ? 'bg-fg/5' : ''
                }`}
              />
              {hovered === index && (
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent/40" />
              )}
            </>
          ),
        }

        return columnLabel ? (
          <button
            key={index}
            type="button"
            onClick={() => onClick?.(index)}
            onFocus={() => onHover(index)}
            onBlur={() => onHover(null)}
            aria-label={columnLabel(index)}
            {...handlers}
          />
        ) : (
          <div key={index} aria-hidden="true" {...handlers} />
        )
      })}
    </div>
  )
}

interface ActivityTimelineProps {
  /** Volume by level, one bucket per column. */
  buckets: HistogramBucket[]
  latency: LatencyOverview | undefined
  from: string
  to: string
  onBucketClick: (start: string, end: string) => void
  /** Dragging across two or more columns zooms into that range; a plain click stays a click. */
  onBrush: (start: string, end: string) => void
  fetching?: boolean
}

/**
 * Volume, duration and requests as three lanes of one timeline.
 *
 * They were three charts in three cards, each with its own time axis, and comparing them meant
 * measuring across a page with your eyes. One axis, one hover, one brush: a spike in p95 sits
 * directly under the bar whose errors explain it, and a reader who drags to zoom zooms all
 * three at once. The lanes stay apart rather than sharing a y-axis because counts and
 * milliseconds do not share a scale — only time is common, and time is what is shared here.
 *
 * Colour keeps one meaning down the card: neutral is normal traffic, amber is worth a look
 * (warnings, p95, 4xx), red is failure (errors, 5xx).
 */
export function ActivityTimeline({
  buckets,
  latency,
  from,
  to,
  onBucketClick,
  onBrush,
  fetching,
}: ActivityTimelineProps) {
  const { t, lang } = useI18n()
  // the lane travels with the column so the readout can open over the plot the pointer is on,
  // while every lane draws the crosshair for the same column
  const [hovered, setHovered] = useState<{ index: number; lane: LaneName } | null>(null)
  const [drag, setDrag] = useState<{ anchor: number; head: number } | null>(null)
  // isolating a status class is a way of looking at the request lane, not a filter on the
  // dashboard: the lanes above it and the panels around it keep answering about everything
  const [statusClass, setStatusClass] = useState<StatusClass | null>(null)

  const shared = { from, to, buckets: TIMELINE_BUCKETS }
  const statusQueries = {
    ok: useHistogram({ ...shared, filter: STATUS_FILTERS.ok }),
    client: useHistogram({ ...shared, filter: STATUS_FILTERS.client }),
    server: useHistogram({ ...shared, filter: STATUS_FILTERS.server }),
  }

  const statusSeries = STATUS_SERIES.map((entry) => ({
    ...entry,
    data: (statusQueries[entry.key].data?.buckets ?? []).map((bucket) => sumLevels(bucket.counts)),
    dimmed: statusClass !== null && statusClass !== entry.key,
  }))

  // the volume series owns the axis; the request lane's own starts stand in only while volume
  // has not landed, so the columns never shift under a reader mid-refresh
  const starts =
    buckets.length > 0
      ? buckets.map((bucket) => bucket.start)
      : (statusQueries.ok.data?.buckets ?? []).map((bucket) => bucket.start)
  const columns = starts.length

  useEffect(() => {
    if (!drag) return
    const { anchor, head } = drag
    function commit() {
      setDrag(null)
      // a same-column release is a plain click; the column's onClick handles it
      if (anchor === head) return
      const low = Math.min(anchor, head)
      const high = Math.max(anchor, head)
      onBrush(starts[low], starts[high + 1] ?? to)
    }
    window.addEventListener('mouseup', commit)
    return () => window.removeEventListener('mouseup', commit)
  }, [drag, starts, to, onBrush])

  function isBrushed(index: number): boolean {
    return drag !== null && index >= Math.min(drag.anchor, drag.head) && index <= Math.max(drag.anchor, drag.head)
  }

  function press(index: number) {
    setDrag({ anchor: index, head: index })
  }

  function hover(index: number | null, lane: LaneName) {
    setHovered(index === null ? null : { index, lane })
    if (index !== null) setDrag((current) => (current ? { ...current, head: index } : null))
  }

  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  const volumeMax = niceCeil(Math.max(1, ...buckets.map((bucket) => sumLevels(bucket.counts))))
  const levelTotal = (level: Level) => buckets.reduce((total, bucket) => total + bucket.counts[level], 0)
  const quietTotal = QUIET_LEVELS.reduce((total, level) => total + levelTotal(level), 0)

  const latencyBuckets = latency?.buckets ?? []
  const avgTrend = carryGaps(latencyBuckets.map((bucket) => bucket.avgMs))
  const p95Trend = carryGaps(latencyBuckets.map((bucket) => bucket.p95Ms))
  const timed = (latency?.sampled ?? 0) > 0

  const visibleStatus = statusSeries.filter((series) => !series.dimmed)
  const statusMax = niceCeil(
    Math.max(
      1,
      ...Array.from({ length: columns }, (_, index) =>
        visibleStatus.reduce((sum, series) => sum + (series.data[index] ?? 0), 0),
      ),
    ),
  )
  const statusTotal = statusSeries.reduce((sum, series) => sum + series.data.reduce((a, b) => a + b, 0), 0)

  const column = hovered?.index ?? null

  /** The whole column's numbers, opened above the lane the pointer is in. */
  function readout(lane: LaneName) {
    if (hovered === null || hovered.lane !== lane || !starts[hovered.index]) return null
    const index = hovered.index
    return (
      <TimelineTooltip
        index={index}
        columns={columns}
        start={starts[index]}
        counts={buckets[index]?.counts}
        avgMs={latencyBuckets[index]?.avgMs ?? null}
        p95Ms={latencyBuckets[index]?.p95Ms ?? null}
        status={statusSeries.map((series) => ({
          label: series.label,
          color: series.color,
          count: series.data[index] ?? 0,
        }))}
      />
    )
  }

  return (
    <Panel className={`p-5 ${fetching ? 'opacity-60 transition-opacity' : ''}`}>
      <div className="relative">
        <Lane
          label={t.nav.events}
          chips={
            <>
              <SeriesChip color={LEVEL_CHART.Information} label={t.dashboard.info} value={compact(quietTotal)} />
              <SeriesChip color={LEVEL_CHART.Warning} label={t.dashboard.warn} value={compact(levelTotal('Warning'))} />
              <SeriesChip color={LEVEL_CHART.Error} label={t.dashboard.errors} value={compact(levelTotal('Error'))} />
              <SeriesChip color={LEVEL_CHART.Fatal} label={t.dashboard.fatal} value={compact(levelTotal('Fatal'))} />
            </>
          }
        >
          <div className="relative">
            <div className="flex min-w-0 items-end gap-[2px]" style={{ height: VOLUME_HEIGHT_PX }} aria-hidden="true">
              {buckets.map((bucket) => {
                const segments = barSegments(bucket.counts)
                return (
                  <div key={bucket.start} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                    {segments.map((segment, segmentIndex) => (
                      <span
                        key={segment.key}
                        className={`w-full shrink-0 ${segmentIndex === segments.length - 1 ? 'rounded-t-[1px]' : ''}`}
                        style={{ height: `${(segment.count / volumeMax) * 100}%`, backgroundColor: segment.color }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
            {readout('volume')}
            <Columns
              count={columns}
              hovered={column}
              isBrushed={isBrushed}
              onHover={(index) => hover(index, 'volume')}
              onPress={press}
              onClick={(index) => onBucketClick(starts[index], starts[index + 1] ?? to)}
              columnLabel={(index) =>
                t.dashboard.bucketAria(
                  formatTimestamp(starts[index], lang),
                  buckets[index] ? sumLevels(buckets[index].counts) : 0,
                )
              }
            />
          </div>
        </Lane>

        <Lane
          label={t.dashboard.duration}
          chips={
            <>
              <SeriesChip
                color={LEVEL_CHART.Information}
                label={t.dashboard.avg}
                value={formatDuration(latency?.avgMs ?? null, lang)}
              />
              <SeriesChip
                color={LEVEL_CHART.Warning}
                label={t.analysis.p95}
                value={formatDuration(latency?.p95Ms ?? null, lang)}
              />
            </>
          }
        >
          {timed ? (
            <div className="relative" style={{ height: DURATION_HEIGHT_PX }}>
              <TrendLine
                centered
                series={[
                  { values: avgTrend, color: LEVEL_CHART.Information },
                  { values: p95Trend, color: LEVEL_CHART.Warning },
                ]}
                className="h-full w-full"
              />
              {readout('duration')}
              <Columns
                count={columns}
                hovered={column}
                isBrushed={isBrushed}
                onHover={(index) => hover(index, 'duration')}
                onPress={press}
              />
            </div>
          ) : (
            // "nothing here was timed" is a different answer from "everything was quick"
            <p className="py-4 text-sm text-fg-muted">{t.dashboard.nothingTimed}</p>
          )}
        </Lane>

        <Lane
          label={t.nav.requests}
          action={<PillLink to={statusClass ? `/requests?status=${statusClass}` : '/requests'}>{t.dashboard.viewAll}</PillLink>}
          chips={statusSeries.map(({ key, label, color, data, dimmed }) => (
            <SeriesChip
              key={key}
              color={color}
              label={label}
              value={compact(data.reduce((a, b) => a + b, 0))}
              pressed={statusClass === key}
              dimmed={dimmed}
              onClick={() => setStatusClass(statusClass === key ? null : key)}
              title={statusClass === key ? t.requests.showAll : t.requests.onlyThis(label)}
            />
          ))}
        >
          {statusTotal > 0 ? (
            <div className="relative">
              <div className="flex min-w-0 items-end gap-[2px]" style={{ height: STATUS_HEIGHT_PX }} aria-hidden="true">
                {Array.from({ length: columns }, (_, index) => (
                  <div key={index} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                    {statusSeries.map(({ key, color, data, dimmed }) => {
                      const count = data[index] ?? 0
                      if (count === 0 || dimmed) return null
                      return (
                        <span
                          key={key}
                          className="w-full shrink-0 transition-[height] duration-300"
                          style={{ height: `${(count / statusMax) * 100}%`, backgroundColor: color }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
              {readout('status')}
              <Columns
                count={columns}
                hovered={column}
                isBrushed={isBrushed}
                onHover={(index) => hover(index, 'status')}
                onPress={press}
              />
            </div>
          ) : (
            <p className="py-4 text-sm text-fg-muted">{t.requests.noStatus}</p>
          )}
        </Lane>

        {/* One axis for three lanes, and the only labels on it: the window's two ends place
            every column, and the exact numbers are one hover away. */}
        {columns > 0 && (
          <div className="mt-2 flex items-baseline justify-between gap-2 font-mono text-xs text-fg-subtle">
            <span>{formatTimestamp(starts[0], lang)}</span>
            <span>{formatTimestamp(to, lang)}</span>
          </div>
        )}
      </div>
    </Panel>
  )
}

interface TimelineTooltipProps {
  index: number
  columns: number
  start: string
  counts: HistogramBucket['counts'] | undefined
  avgMs: number | null
  p95Ms: number | null
  status: { label: string; color: string; count: number }[]
}

/**
 * Every lane's reading at one instant, in one card.
 *
 * Three lanes hovering as one would otherwise mean three tooltips fighting for the same
 * corner; this is the whole column in a single readout, anchored over it and pulled inside
 * the plot at the edges so the last column's numbers are not half off the card.
 */
function TimelineTooltip({ index, columns, start, counts, avgMs, p95Ms, status }: TimelineTooltipProps) {
  const { t, lang } = useI18n()
  const position = (index + 0.5) / Math.max(1, columns)
  const anchor = position < 0.2 ? 'translate-x-0' : position > 0.8 ? '-translate-x-full' : '-translate-x-1/2'

  return (
    <div
      className={`pointer-events-none absolute bottom-full z-10 mb-2 w-52 ${anchor}`}
      style={{ left: `${position * 100}%` }}
    >
      <Card className="p-2 text-xs">
        <p className="mb-1 text-fg-muted">{formatTimestamp(start, lang)}</p>

        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-fg-muted">{t.dashboard.total}</span>
          <span className="tabular font-semibold text-fg">{counts ? sumLevels(counts) : 0}</span>
        </div>
        {ALERT_LEVELS.map((level) => (
          <div key={level} className="flex items-center gap-2 py-0.5">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: LEVEL_HEX[level] }} />
            <span className="tabular font-semibold text-fg">{counts?.[level] ?? 0}</span>
            <span className="text-fg-muted">{level}</span>
          </div>
        ))}

        <div className="mt-1 flex justify-between gap-2 border-t border-border pt-1">
          <span className="text-fg-muted">{t.dashboard.avg}</span>
          <span className="tabular font-semibold text-fg">{formatDuration(avgMs, lang)}</span>
        </div>
        <div className="flex justify-between gap-2 py-0.5">
          <span className="text-fg-muted">{t.analysis.p95}</span>
          <span className="tabular font-semibold text-fg">{formatDuration(p95Ms, lang)}</span>
        </div>

        <div className="mt-1 flex flex-wrap justify-between gap-x-3 border-t border-border pt-1">
          {status.map((series) => (
            <span key={series.label} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: series.color }} />
              <span className="text-fg-muted">{series.label}</span>
              <span className="tabular font-semibold text-fg">{series.count}</span>
            </span>
          ))}
        </div>
      </Card>
    </div>
  )
}
