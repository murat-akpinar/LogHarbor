import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { HistogramBucket, LatencyOverview, Level } from '../../types'
import { useHistogram } from '../../hooks/useStats'
import { ALERT_LEVELS, LEVEL_CHART, LEVEL_HEX, QUIET_LEVELS, barSegments, sumLevels } from '../../lib/levels'
import { SERIES, barFill, barGlow } from '../../lib/series'
import { STATUS_FILTERS, STATUS_SERIES } from '../../lib/status'
import type { StatusClass } from '../../lib/status'
import { formatTimestamp } from '../../lib/dates'
import { formatDuration } from '../../lib/duration'
import { plotMax, sweep } from '../../lib/plotScale'
import { useI18n } from '../../i18n'
import { Card } from '../ui/Card'
import { Panel } from '../ui/Panel'
import { PillLink } from '../ui/PillLink'
import { SeriesChip } from '../ui/SeriesChip'
import { TrendLine } from '../Sparkline'
import { TimeAxis } from '../TimeAxis'

/**
 * The timeline's resolution. Callers fetch their own series at this width so every lane lands
 * on the same columns.
 *
 * 120, not the 60 a chart in a half-width card used: this card is as wide as the page, and 60
 * columns stretched across it are slabs rather than the skyline the shape needs. The gap goes
 * to 1px for the same reason — at this width 2px eats a fifth of every bar.
 */
export const TIMELINE_BUCKETS = 120

const VOLUME_HEIGHT_PX = 152
const DURATION_HEIGHT_PX = 72
const STATUS_HEIGHT_PX = 60
/** Bars and the hit areas over them are two flex rows that have to line up exactly. */
const COLUMN_GAP = 'gap-px'

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
    <div className={`absolute inset-0 flex ${COLUMN_GAP}`}>
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
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent/60 shadow-[0_0_6px_0_var(--color-accent)]" />
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
  // every lane's legend isolates its own series: a way of looking at that lane, not a filter on
  // the dashboard, so the other lanes and the panels around them keep answering about everything
  const [levelPick, setLevelPick] = useState<string | null>(null)
  const [durationPick, setDurationPick] = useState<'avg' | 'p95' | null>(null)
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

  const levelTotal = (level: Level) => buckets.reduce((total, bucket) => total + bucket.counts[level], 0)
  const quietTotal = QUIET_LEVELS.reduce((total, level) => total + levelTotal(level), 0)
  const volumeSeries = [
    { key: 'quiet', label: t.dashboard.info, color: LEVEL_CHART.Information, total: quietTotal },
    { key: 'Warning', label: t.dashboard.warn, color: LEVEL_CHART.Warning, total: levelTotal('Warning') },
    { key: 'Error', label: t.dashboard.errors, color: LEVEL_CHART.Error, total: levelTotal('Error') },
    { key: 'Fatal', label: t.dashboard.fatal, color: LEVEL_CHART.Fatal, total: levelTotal('Fatal') },
  ]
  // isolating a level rescales the lane to it, which is the point of being able to: forty errors
  // under a thousand info lines are a flat red smear until they are drawn against their own max
  const volumeBars = buckets.map((bucket) =>
    barSegments(bucket.counts).filter((segment) => levelPick === null || segment.key === levelPick),
  )
  const volumeMax = plotMax(volumeBars.map((segments) => segments.reduce((sum, segment) => sum + segment.count, 0)))

  const latencyBuckets = latency?.buckets ?? []
  // the one lane where colour is not severity: an average and a p95 are two measurements of the
  // same thing, neither of them a problem in itself, and two neutrals could not be told apart
  const durationSeries = [
    { key: 'avg' as const, label: t.dashboard.avg, color: SERIES.avg, ms: latency?.avgMs ?? null },
    { key: 'p95' as const, label: t.analysis.p95, color: SERIES.p95, ms: latency?.p95Ms ?? null },
  ]
  const durationLines = [
    { key: 'avg', values: carryGaps(latencyBuckets.map((bucket) => bucket.avgMs)), color: SERIES.avg },
    { key: 'p95', values: carryGaps(latencyBuckets.map((bucket) => bucket.p95Ms)), color: SERIES.p95 },
  ].filter((line) => durationPick === null || durationPick === line.key)
  const timed = (latency?.sampled ?? 0) > 0

  const visibleStatus = statusSeries.filter((series) => !series.dimmed)
  const statusMax = plotMax(
    Array.from({ length: columns }, (_, index) =>
      visibleStatus.reduce((sum, series) => sum + (series.data[index] ?? 0), 0),
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
          chips={volumeSeries.map(({ key, label, color, total }) => (
            <SeriesChip
              key={key}
              color={color}
              label={label}
              value={compact(total)}
              pressed={levelPick === key}
              dimmed={levelPick !== null && levelPick !== key}
              onClick={() => setLevelPick(levelPick === key ? null : key)}
              title={levelPick === key ? t.requests.showAll : t.requests.onlyThis(label)}
            />
          ))}
        >
          <div className="relative">
            <div
              className={`flex min-w-0 items-end ${COLUMN_GAP}`}
              style={{ height: VOLUME_HEIGHT_PX }}
              aria-hidden="true"
            >
              {volumeBars.map((segments, index) => (
                // keyed by position, not by timestamp: in live mode the timestamps shift every
                // ten seconds, and keying on them would remount every column and replay the
                // entrance animation over and over while somebody is reading the chart
                <div
                  key={index}
                  className="animate-grow flex h-full min-w-0 flex-1 flex-col-reverse"
                  style={{ '--delay': `${sweep(index, columns)}ms` } as CSSProperties}
                >
                  {segments.map((segment, segmentIndex) => (
                    <span
                      key={segment.key}
                      className={`w-full shrink-0 transition-[height] duration-500 ${
                        segmentIndex === segments.length - 1 ? 'rounded-t-[2px]' : ''
                      }`}
                      style={{
                        height: `${(segment.count / volumeMax) * 100}%`,
                        // a bucket holding one event is not an empty bucket
                        minHeight: '1px',
                        background: barFill(segment.color),
                        boxShadow: segment.lit ? barGlow(segment.color) : undefined,
                      }}
                    />
                  ))}
                </div>
              ))}
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
          chips={durationSeries.map(({ key, label, color, ms }) => (
            <SeriesChip
              key={key}
              color={color}
              label={label}
              value={formatDuration(ms, lang)}
              pressed={durationPick === key}
              dimmed={durationPick !== null && durationPick !== key}
              onClick={() => setDurationPick(durationPick === key ? null : key)}
              title={durationPick === key ? t.requests.showAll : t.requests.onlyThis(label)}
            />
          ))}
        >
          {timed ? (
            <div className="relative" style={{ height: DURATION_HEIGHT_PX }}>
              {/* filled, so the lane carries the weight of the bars above and below it instead
                  of reading as a stray hairline between two charts */}
              <TrendLine centered fill series={durationLines} className="h-full w-full" />
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
              <div
                className={`flex min-w-0 items-end ${COLUMN_GAP}`}
                style={{ height: STATUS_HEIGHT_PX }}
                aria-hidden="true"
              >
                {Array.from({ length: columns }, (_, index) => (
                  <div
                    key={index}
                    className="animate-grow flex h-full min-w-0 flex-1 flex-col-reverse"
                    style={{ '--delay': `${sweep(index, columns)}ms` } as CSSProperties}
                  >
                    {statusSeries.map(({ key, color, data, dimmed, lit }) => {
                      const count = data[index] ?? 0
                      if (count === 0 || dimmed) return null
                      return (
                        <span
                          key={key}
                          className="w-full shrink-0 rounded-t-[2px] transition-[height] duration-500"
                          style={{
                            height: `${(count / statusMax) * 100}%`,
                            minHeight: '1px',
                            background: barFill(color),
                            boxShadow: lit ? barGlow(color) : undefined,
                          }}
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

        {/* One axis for three lanes. It was the window's two ends until 2026-07-31, on the
            argument that a reader can place a bar between them; at 120 columns over an
            arbitrary window that is arithmetic nobody should be doing, so it ticks now. */}
        {columns > 0 && <TimeAxis from={starts[0]} to={to} className="mt-2" />}
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
      <Card variant="float" className="p-2 text-xs">
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
