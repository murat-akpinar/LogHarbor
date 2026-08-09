import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  useFindings,
  useHeatmap,
  useHistogram,
  useIngestionLag,
  useIngestRejections,
  useLatency,
  useOperations,
  useServices,
  useSlowOperations,
  useSummary,
  useTopErrors,
  useTopExceptions,
  useUserActivity,
} from '../hooks/useStats'
import { ActivityTimeline, TIMELINE_BUCKETS } from '../components/dashboard/ActivityTimeline'
import { AlarmDeck } from '../components/dashboard/AlarmDeck'
import { FindingsBand } from '../components/dashboard/FindingsBand'
import { IngestionLagStrip } from '../components/dashboard/IngestionLagStrip'
import { IngestRejectionBanner } from '../components/dashboard/IngestRejectionBanner'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { Skeleton } from '../components/ui/States'
import { StatTile } from '../components/StatTile'
import { HelpLines } from '../components/ui/Tooltip'
import { formatDuration } from '../lib/duration'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { TopErrorsPanel } from '../components/dashboard/TopErrorsPanel'
import { ExceptionsPanel } from '../components/dashboard/ExceptionsPanel'
import { ServicesPanel } from '../components/dashboard/ServicesPanel'
import { SlowOpsPanel } from '../components/dashboard/SlowOpsPanel'
import { RoutesPanel } from '../components/dashboard/RoutesPanel'
import { UsersPanel } from '../components/dashboard/UsersPanel'
import { Heatmap } from '../components/Heatmap'
import { Card } from '../components/ui/Card'
import type { HistogramBucket } from '../types'
import { useAlerts } from '../hooks/useAlerts'
import { firingRules } from '../lib/alerts'
import { LEVELS } from '../lib/levels'
import { SERIES } from '../lib/series'
import { useI18n } from '../i18n'

const PANEL_LIMIT = 5
// the services panel shows the top few, but the section header counts them, so the query has to
// see more than five. 100 is the endpoint's ceiling, which is why it says "100+" when it hits it
const SERVICE_SCAN_LIMIT = 100
// deliberately not tied to the page's time range: a client that broke on Friday is still
// broken on Monday, and the operator needs to see that on a dashboard set to "last hour"
const REJECTION_DAYS = 7

/** Bucket counts collapsed to one number per bucket: the shape, not the breakdown. */
function trendOf(buckets: HistogramBucket[] | undefined): number[] {
  return (buckets ?? []).map((bucket) => LEVELS.reduce((total, level) => total + bucket.counts[level], 0))
}

/** Null when the previous window held nothing: "up from zero" is not a percentage, and showing
 *  one would put an invented number next to a real one. */
function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function DashboardPage() {
  const { t, lang } = useI18n()
  const help = t.dashboard.help
  const navigate = useNavigate()
  const { live, range, presetKey, toggleLive, setRange, setPreset } = useLiveRange()

  // the window immediately before this one, same length: what "vs previous period" measures
  const previousRange = useMemo(() => {
    const from = new Date(range.from).getTime()
    const span = Math.max(1, new Date(range.to).getTime() - from)
    return { from: new Date(from - span).toISOString(), to: range.from }
  }, [range.from, range.to])

  // What is alarming right now, derived from the rules themselves (lib/alerts): a rule that
  // triggered inside its own window, is enabled and is not acknowledged. `range.to` is the
  // clock this page already advances on, so the deck appears and clears on the same tick the
  // rest of the page moves with, and no extra timer is needed.
  const alerts = useAlerts()
  const firing = useMemo(
    () => firingRules(alerts.data, new Date(range.to).getTime()),
    [alerts.data, range.to],
  )

  // What nobody wrote a rule for. Same range as everything else on the page, so it moves with the
  // picker; no filter, because a findings scan asks what the server noticed, not what you asked.
  const findings = useFindings({ from: range.from, to: range.to })

  const summary = useSummary(range)
  const previousSummary = useSummary(previousRange)
  const histogram = useHistogram({ ...range, buckets: TIMELINE_BUCKETS })
  const heatmap = useHeatmap(range)
  const ingestionLag = useIngestionLag(range)
  const latency = useLatency({ ...range, buckets: TIMELINE_BUCKETS })
  const rejections = useIngestRejections(REJECTION_DAYS)
  const topErrors = useTopErrors({ ...range, limit: PANEL_LIMIT })
  const topExceptions = useTopExceptions({ ...range, limit: PANEL_LIMIT })
  const services = useServices({ ...range, limit: SERVICE_SCAN_LIMIT })
  const slow = useSlowOperations({ ...range, limit: PANEL_LIMIT })
  // wider than the panel shows: splitting one request template into its routes makes each route
  // smaller than the busiest job templates, so the routes have to be picked out of a longer list
  const operations = useOperations({ ...range, limit: SERVICE_SCAN_LIMIT })
  const users = useUserActivity({ ...range, property: 'UserId', limit: PANEL_LIMIT })

  const byLevel = summary.data?.byLevel
  const total = summary.data?.total ?? 0
  const errors = (byLevel?.Error ?? 0) + (byLevel?.Fatal ?? 0)
  const errorRate = total > 0 ? (errors / total) * 100 : 0

  const previousByLevel = previousSummary.data?.byLevel
  const previousErrors = (previousByLevel?.Error ?? 0) + (previousByLevel?.Fatal ?? 0)
  const eventTrend = trendOf(histogram.data?.buckets)
  // the same buckets the volume chart draws, read for their top two levels: an error series is
  // a slice of the volume series, not a second query
  const errorTrend = (histogram.data?.buckets ?? []).map((bucket) => bucket.counts.Error + bucket.counts.Fatal)
  // a gap in a latency series is "nothing was timed here", and the line carries it as a flat
  // stretch rather than a drop to zero, which would read as "it got fast"
  const avgTrend = (latency.data?.buckets ?? []).map((bucket) => bucket.avgMs ?? 0)
  const p95Trend = (latency.data?.buckets ?? []).map((bucket) => bucket.p95Ms ?? 0)
  const serviceCount = services.data?.services.length ?? 0

  // a panel called Routes shows routes; an install whose events carry no route property has none
  // to show, and then the busiest operations are still the best answer it can give
  const allOperations = operations.data?.operations ?? []
  const routes = allOperations.filter((op) => op.route !== null)
  const routeRows = (routes.length > 0 ? routes : allOperations).slice(0, PANEL_LIMIT)
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  const queryError = summary.error ?? histogram.error

  function goToEvents(from: string, to: string) {
    navigate(`/events?${new URLSearchParams({ from, to }).toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t.dashboard.title}</h1>
        <LiveRangeControls
          live={live}
          onToggleLive={toggleLive}
          from={range.from}
          to={range.to}
          presetKey={presetKey}
          onRangeChange={setRange}
          onPreset={setPreset}
        />
      </div>

      {queryError && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queryError.message}</p>}

      {firing.length > 0 && <AlarmDeck firing={firing} from={range.from} to={range.to} />}

      {/* Everything below is context, and while something is alarming the context is not the
          answer. Dimmed rather than hidden: the page has to stay readable for the operator who
          wants it, and un-dimming the moment the alarm is acknowledged is what tells them the
          click landed. `now` moves with the page's own tick, so the state clears by itself. */}
      {/* data-dimmed is the handle, not the classes: what "stepped back" looks like is a
          judgement that gets retuned by looking at a real alarm, and a test should not hold it
          to one opacity. Desaturation carries most of the weight — on a dark canvas 40% opacity
          barely changes a near-black surface, but the level colours going grey is unmistakable,
          and colour is what these charts say things with. */}
      <div
        data-dimmed={firing.length > 0 ? '' : undefined}
        className={`flex flex-col gap-4 transition-[opacity,filter] duration-500 ${
          firing.length > 0 ? 'opacity-50 saturate-[0.25]' : ''
        }`}
      >
      {/* Inside the dimmed block on purpose: while a real alarm is up, a guess is context too. */}
      {(findings.data?.findings.length ?? 0) > 0 && (
        <FindingsBand findings={findings.data!.findings} from={range.from} to={range.to} />
      )}

      {summary.data && total === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-fg-muted">{t.dashboard.noEventsYet}</p>
          <Link to="/send" className="mt-1 inline-block text-sm text-accent hover:underline">
            {t.send.title} →
          </Link>
        </Card>
      )}

      {/* Events the server refused: not in any chart below, because they were never stored */}
      {rejections.data && (
        <IngestRejectionBanner
          rejections={rejections.data.rejections}
          totalRequests={rejections.data.totalRequests}
          days={REJECTION_DAYS}
        />
      )}

      {/* The glance band: five figures, each with the shape it took getting there and whether
          that is more or less than the window before it */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {/* each tile's line is drawn in that series' own colour, and it is the same colour the
            series takes in the timeline below and in its chip: volume green, errors red, avg
            cyan, p95 violet. The bars stay neutral — only measured lines are named. */}
        <StatTile
          label={t.nav.events}
          value={compact(total)}
          icon="events"
          trend={eventTrend}
          trendColor={SERIES.volume}
          delta={percentChange(total, previousSummary.data?.total ?? 0)}
          index={0}
          help={
            <HelpLines
              lines={[
                help.events.what,
                help.events.reading(total.toLocaleString(lang), errors.toLocaleString(lang)),
                help.delta,
              ]}
            />
          }
        />
        <StatTile
          label={t.dashboard.errorRate}
          value={`${errorRate.toFixed(1)}%`}
          icon="exceptions"
          plate="error"
          trend={errorTrend}
          trendColor={SERIES.errors}
          delta={percentChange(errors, previousErrors)}
          upIsBad
          index={1}
          help={
            <HelpLines
              lines={[
                help.errorRate.what,
                help.errorRate.reading(errors.toLocaleString(lang), total.toLocaleString(lang)),
                help.errorRate.note,
                help.delta,
              ]}
            />
          }
        />
        <StatTile
          label={t.dashboard.avgLatency}
          value={formatDuration(latency.data?.avgMs ?? null, lang)}
          icon="requests"
          plate="info"
          trend={avgTrend}
          trendColor={SERIES.avg}
          upIsBad
          index={2}
          help={<HelpLines lines={[help.avgLatency.what, help.avgLatency.note]} />}
        />
        <StatTile
          label={t.dashboard.p95Latency}
          value={formatDuration(latency.data?.p95Ms ?? null, lang)}
          icon="queries"
          plate="warning"
          trend={p95Trend}
          trendColor={SERIES.p95}
          upIsBad
          index={3}
          help={<HelpLines lines={[help.p95Latency.what, help.p95Latency.note]} />}
        />
        <StatTile
          label={t.dashboard.activeServices}
          value={serviceCount >= SERVICE_SCAN_LIMIT ? `${SERVICE_SCAN_LIMIT}+` : serviceCount.toLocaleString(lang)}
          icon="services"
          plate="accent"
          index={4}
          help={
            <HelpLines
              lines={[
                help.activeServices.what,
                serviceCount >= SERVICE_SCAN_LIMIT && help.activeServices.note(SERVICE_SCAN_LIMIT.toLocaleString(lang)),
              ]}
            />
          }
        />
      </div>

      {/* Activity: volume, duration and requests over one time axis. They were four cards with
          four axes, which made comparing them a job for the reader's eyes; the lanes share a
          hover, a brush and a window, so a slow minute and the errors in it line up. */}
      <SectionBlock
        icon="events"
        title={t.dashboard.activity}
        to="/events"
        linkLabel={t.dashboard.viewAll}
        index={1}
      >
        {/* sits above the timeline on purpose: it says whether to trust its x-axis */}
        {ingestionLag.data && (
          <div className="mb-3">
            <IngestionLagStrip lag={ingestionLag.data.lag} />
          </div>
        )}
        <ActivityTimeline
          buckets={histogram.data?.buckets ?? []}
          latency={latency.data}
          from={range.from}
          to={range.to}
          onBucketClick={goToEvents}
          onBrush={(from, to) => setRange({ from, to })}
          fetching={histogram.isFetching || latency.isFetching}
        />
      </SectionBlock>

      {/* Analysis: what is failing and what is slow */}
      <SectionBlock
        icon="analysis"
        title={t.analysis.title}
        to="/analysis"
        linkLabel={t.dashboard.viewAll}
        index={2}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TopErrorsPanel errors={topErrors.data?.errors ?? []} from={range.from} to={range.to} />
          <ExceptionsPanel exceptions={topExceptions.data?.exceptions ?? []} />
          <RoutesPanel operations={routeRows} from={range.from} to={range.to} />
          <SlowOpsPanel result={slow.data} from={range.from} to={range.to} />
        </div>
      </SectionBlock>

      {/* Who and where: services and the users behind the traffic */}
      <SectionBlock
        icon="services"
        title={t.dashboard.servicesUsers}
        meta={serviceCount >= SERVICE_SCAN_LIMIT ? `${SERVICE_SCAN_LIMIT}+` : serviceCount.toLocaleString(lang)}
        index={3}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <ServicesPanel services={(services.data?.services ?? []).slice(0, PANEL_LIMIT)} from={range.from} to={range.to} />
          <UsersPanel users={users.data?.users ?? []} from={range.from} to={range.to} />
        </div>
      </SectionBlock>

      <SectionBlock icon="dashboard" title={t.dashboard.activityByHour} index={4}>
        <Panel className="p-4">
          {/* the height the grid will take, so the section does not jump when it lands */}
          {heatmap.isLoading && <Skeleton className="h-40 w-full" />}
          {heatmap.data && (
            <div className={heatmap.isFetching ? 'opacity-60 transition-opacity' : ''}>
              <Heatmap cells={heatmap.data.cells} />
            </div>
          )}
        </Panel>
      </SectionBlock>
      </div>
    </div>
  )
}
