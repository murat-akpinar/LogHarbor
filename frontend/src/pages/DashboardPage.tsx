import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
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
import { MetricCard } from '../components/dashboard/MetricCard'
import { IngestionLagStrip } from '../components/dashboard/IngestionLagStrip'
import { IngestRejectionBanner } from '../components/dashboard/IngestRejectionBanner'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { StatTile } from '../components/StatTile'
import { StatusChart } from '../components/requests/StatusChart'
import { PillLink } from '../components/ui/PillLink'
import { TrendLine } from '../components/Sparkline'
import { formatDuration } from '../lib/duration'
import { formatTimestamp } from '../lib/dates'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { TopErrorsPanel } from '../components/dashboard/TopErrorsPanel'
import { ExceptionsPanel } from '../components/dashboard/ExceptionsPanel'
import { ServicesPanel } from '../components/dashboard/ServicesPanel'
import { SlowOpsPanel } from '../components/dashboard/SlowOpsPanel'
import { RoutesPanel } from '../components/dashboard/RoutesPanel'
import { UsersPanel } from '../components/dashboard/UsersPanel'
import { Histogram } from '../components/Histogram'
import { Heatmap } from '../components/Heatmap'
import { Card } from '../components/ui/Card'
import type { HistogramBucket } from '../types'
import { LEVELS, LEVEL_CHART } from '../lib/levels'
import { useI18n } from '../i18n'

// A skyline, not a bar chart: enough columns that the shape of an hour is legible and each
// column is thin enough to read as a tick. Twenty-four stretched across a card gave slabs.
const BUCKET_COUNT = 60
const PANEL_LIMIT = 5
// the services panel shows the top few, but the section header counts them, so the query has to
// see more than five. 100 is the endpoint's ceiling, which is why it says "100+" when it hits it
const SERVICE_SCAN_LIMIT = 100
const ERROR_FILTER = "@Level = 'Error' or @Level = 'Fatal'"
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
  const navigate = useNavigate()
  const { live, range, toggleLive, setRange } = useLiveRange()

  // the window immediately before this one, same length: what "vs previous period" measures
  const previousRange = useMemo(() => {
    const from = new Date(range.from).getTime()
    const span = Math.max(1, new Date(range.to).getTime() - from)
    return { from: new Date(from - span).toISOString(), to: range.from }
  }, [range.from, range.to])

  const summary = useSummary(range)
  const previousSummary = useSummary(previousRange)
  const histogram = useHistogram({ ...range, buckets: BUCKET_COUNT })
  const errorHistogram = useHistogram({ ...range, buckets: BUCKET_COUNT, filter: ERROR_FILTER })
  const heatmap = useHeatmap(range)
  const ingestionLag = useIngestionLag(range)
  const latency = useLatency({ ...range, buckets: BUCKET_COUNT })
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
  const errorTrend = trendOf(errorHistogram.data?.buckets)
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
          onRangeChange={setRange}
        />
      </div>

      {queryError && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queryError.message}</p>}

      {summary.data && total === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-fg-muted">{t.dashboard.noEventsYet}</p>
          <Link to="/events" className="mt-1 inline-block text-sm text-accent hover:underline">
            {t.onboarding.title} →
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
        <StatTile
          label={t.nav.events}
          value={compact(total)}
          icon="events"
          trend={eventTrend}
          trendColor={LEVEL_CHART.Information}
          delta={percentChange(total, previousSummary.data?.total ?? 0)}
        />
        <StatTile
          label={t.dashboard.errorRate}
          value={`${errorRate.toFixed(1)}%`}
          icon="exceptions"
          plate="error"
          trend={errorTrend}
          trendColor={LEVEL_CHART.Error}
          delta={percentChange(errors, previousErrors)}
          upIsBad
        />
        <StatTile
          label={t.dashboard.avgLatency}
          value={formatDuration(latency.data?.avgMs ?? null, lang)}
          icon="requests"
          plate="info"
          trend={avgTrend}
          trendColor={LEVEL_CHART.Information}
          upIsBad
        />
        <StatTile
          label={t.dashboard.p95Latency}
          value={formatDuration(latency.data?.p95Ms ?? null, lang)}
          icon="queries"
          plate="warning"
          trend={p95Trend}
          trendColor={LEVEL_CHART.Warning}
          upIsBad
        />
        <StatTile
          label={t.dashboard.activeServices}
          value={serviceCount >= SERVICE_SCAN_LIMIT ? `${SERVICE_SCAN_LIMIT}+` : serviceCount.toLocaleString(lang)}
          icon="services"
          plate="accent"
        />
      </div>

      {/* Activity: the pulse of raw volume and errors over time. The figures that used to sit
          in a band of tiles above this are the same figures these cards already lead with. */}
      <SectionBlock
        icon="events"
        title={t.dashboard.activity}
        to="/events"
        linkLabel={t.dashboard.viewAll}
      >
        {/* sits above the volume charts on purpose: it says whether to trust their x-axis */}
        {ingestionLag.data && (
          <div className="mb-3">
            <IngestionLagStrip lag={ingestionLag.data.lag} />
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          <MetricCard
            eyebrow={t.nav.events}
            value={compact(total)}
            delta={percentChange(total, previousSummary.data?.total ?? 0)}
            // the swatches are the chart's key, so they take the chart's colours: everything
            // below Warning draws neutral, which is what the Information swatch says here
            breakdown={[
              { label: t.dashboard.info, value: compact(byLevel?.Information ?? 0), color: LEVEL_CHART.Information },
              { label: t.dashboard.warn, value: compact(byLevel?.Warning ?? 0), color: LEVEL_CHART.Warning },
              { label: t.dashboard.errors, value: compact(errors), color: LEVEL_CHART.Error },
            ]}
          >
            {histogram.data && (
              <div className={histogram.isFetching ? 'opacity-60 transition-opacity' : ''}>
                <Histogram
                  buckets={histogram.data.buckets}
                  rangeEnd={range.to}
                  onBucketClick={goToEvents}
                  onBrush={(from, to) => setRange({ from, to })}
                  showLegend={false}
                />
              </div>
            )}
          </MetricCard>

          {/* The reference's second Activity chart: how long things took, not how many there
              were. Two lines on one scale, because an average drawn against its own maximum
              would sit at the same height as the p95 above it and hide the gap. */}
          <MetricCard
            eyebrow={t.dashboard.duration}
            value={
              latency.data && latency.data.sampled > 0
                ? `${formatDuration(latency.data.avgMs, lang)} — ${formatDuration(latency.data.p95Ms, lang)}`
                : '—'
            }
            breakdown={[
              { label: t.dashboard.avg, value: formatDuration(latency.data?.avgMs ?? null, lang), color: LEVEL_CHART.Information },
              { label: t.analysis.p95, value: formatDuration(latency.data?.p95Ms ?? null, lang), color: LEVEL_CHART.Warning },
            ]}
          >
            {latency.data && (
              <div className={latency.isFetching ? 'opacity-60 transition-opacity' : ''}>
                {latency.data.sampled > 0 ? (
                  <>
                    <TrendLine
                      series={[
                        { values: avgTrend, color: LEVEL_CHART.Information },
                        { values: p95Trend, color: LEVEL_CHART.Warning },
                      ]}
                      className="h-40 w-full"
                    />
                    <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-xs text-fg-subtle">
                      <span>{formatTimestamp(range.from, lang)}</span>
                      <span>{formatTimestamp(range.to, lang)}</span>
                    </div>
                  </>
                ) : (
                  // "nothing here was timed" is a different answer from "everything was quick"
                  <p className="py-10 text-center text-sm text-fg-muted">{t.dashboard.nothingTimed}</p>
                )}
              </div>
            )}
          </MetricCard>

          {/* The request timeline, sampled here: the shape of 4xx and 5xx over the window is
              worth a glance before anyone opens the Requests page for the routes behind it.
              Clicking a class opens that page already narrowed to it. */}
          <Panel className="p-5">
            <StatusChart
              from={range.from}
              to={range.to}
              title={t.nav.requests}
              action={<PillLink to="/requests">{t.dashboard.viewAll}</PillLink>}
              selected={null}
              onSelect={(next) =>
                next && navigate(`/requests?${new URLSearchParams({ status: next }).toString()}`)
              }
            />
          </Panel>

          <MetricCard
            eyebrow={t.dashboard.errors}
            value={compact(errors)}
            delta={percentChange(errors, previousErrors)}
            upIsBad
            breakdown={[
              // a rate is not a series in the chart below, so it carries no swatch
              { label: t.dashboard.rate, value: `${errorRate.toFixed(1)}%` },
              { label: t.dashboard.fatal, value: compact(byLevel?.Fatal ?? 0), color: LEVEL_CHART.Fatal },
            ]}
          >
            {errorHistogram.data && (
              <div className={errorHistogram.isFetching ? 'opacity-60 transition-opacity' : ''}>
                <Histogram
                  buckets={errorHistogram.data.buckets}
                  rangeEnd={range.to}
                  onBucketClick={goToEvents}
                  onBrush={(from, to) => setRange({ from, to })}
                  showLegend={false}
                />
              </div>
            )}
          </MetricCard>
        </div>
      </SectionBlock>

      {/* Analysis: what is failing and what is slow */}
      <SectionBlock
        icon="analysis"
        title={t.analysis.title}
        to="/analysis"
        linkLabel={t.dashboard.viewAll}
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
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <ServicesPanel services={(services.data?.services ?? []).slice(0, PANEL_LIMIT)} from={range.from} to={range.to} />
          <UsersPanel users={users.data?.users ?? []} from={range.from} to={range.to} />
        </div>
      </SectionBlock>

      <SectionBlock icon="dashboard" title={t.dashboard.activityByHour}>
        <Panel className="p-4">
          {heatmap.isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
          {heatmap.data && (
            <div className={heatmap.isFetching ? 'opacity-60 transition-opacity' : ''}>
              <Heatmap cells={heatmap.data.cells} />
            </div>
          )}
        </Panel>
      </SectionBlock>
    </div>
  )
}
