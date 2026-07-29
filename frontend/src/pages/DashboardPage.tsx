import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  useHeatmap,
  useHistogram,
  useIngestionLag,
  useIngestRejections,
  useOperations,
  useServices,
  useSlowOperations,
  useSummary,
  useTopErrors,
  useTopExceptions,
  useUserActivity,
} from '../hooks/useStats'
import { MetricCard } from '../components/dashboard/MetricCard'
import { StatTile } from '../components/StatTile'
import { IngestionLagStrip, formatLag } from '../components/dashboard/IngestionLagStrip'
import { IngestRejectionBanner } from '../components/dashboard/IngestRejectionBanner'
import { SectionHeader } from '../components/dashboard/SectionHeader'
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
import { LEVELS, LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const BUCKET_COUNT = 24
const PANEL_LIMIT = 5
// the services panel shows the top few, but the tile counts them, so the query has to see more
// than five. 100 is the endpoint's ceiling, which is why the tile says "100+" when it hits it
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
  const rejections = useIngestRejections(REJECTION_DAYS)
  const topErrors = useTopErrors({ ...range, limit: PANEL_LIMIT })
  const topExceptions = useTopExceptions({ ...range, limit: PANEL_LIMIT })
  const services = useServices({ ...range, limit: SERVICE_SCAN_LIMIT })
  const slow = useSlowOperations({ ...range, limit: PANEL_LIMIT })
  const operations = useOperations({ ...range, limit: PANEL_LIMIT })
  const users = useUserActivity({ ...range, property: 'UserId', limit: PANEL_LIMIT })

  const byLevel = summary.data?.byLevel
  const total = summary.data?.total ?? 0
  const errors = (byLevel?.Error ?? 0) + (byLevel?.Fatal ?? 0)
  const errorRate = total > 0 ? (errors / total) * 100 : 0

  const previousByLevel = previousSummary.data?.byLevel
  const previousErrors = (previousByLevel?.Error ?? 0) + (previousByLevel?.Fatal ?? 0)
  const eventTrend = trendOf(histogram.data?.buckets)
  const errorTrend = trendOf(errorHistogram.data?.buckets)
  const lag = ingestionLag.data?.lag
  const serviceCount = services.data?.services.length ?? 0
  const compact = (value: number) =>
    new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)

  const queryError = summary.error ?? histogram.error

  function goToEvents(from: string, to: string) {
    navigate(`/events?${new URLSearchParams({ from, to }).toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
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

      {/* The glance band: four figures and whether each is more or less than the window before */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.dashboard.totalEvents}
          value={compact(total)}
          icon="events"
          trend={eventTrend}
          trendColor={LEVEL_HEX.Information}
          delta={percentChange(total, previousSummary.data?.total ?? 0)}
        />
        <StatTile
          label={t.dashboard.errors}
          value={compact(errors)}
          icon="exceptions"
          plate="error"
          trend={errorTrend}
          trendColor={LEVEL_HEX.Error}
          delta={percentChange(errors, previousErrors)}
          upIsBad
        />
        <StatTile
          label={t.nav.services}
          value={serviceCount >= SERVICE_SCAN_LIMIT ? `${SERVICE_SCAN_LIMIT}+` : serviceCount.toLocaleString(lang)}
          icon="services"
          plate="info"
        />
        <StatTile
          label={t.dashboard.ingestionLag}
          value={lag && lag.total > 0 ? formatLag(lag.maxSeconds, t.dashboard.lagUnits) : '—'}
          icon="requests"
          plate="warning"
        />
      </div>

      {/* Activity: the pulse of raw volume and errors over time */}
      <section>
        <SectionHeader title={t.dashboard.activity} to="/events" linkLabel={t.dashboard.viewAll} />
        {/* sits above the volume charts on purpose: it says whether to trust their x-axis */}
        {ingestionLag.data && (
          <div className="mb-3">
            <IngestionLagStrip lag={ingestionLag.data.lag} />
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricCard
            eyebrow={t.nav.events}
            value={compact(total)}
            icon="events"
            breakdown={[
              { label: t.dashboard.info, value: compact(byLevel?.Information ?? 0), color: LEVEL_HEX.Information },
              { label: t.dashboard.warn, value: compact(byLevel?.Warning ?? 0), color: LEVEL_HEX.Warning, tone: 'warning' },
              { label: t.dashboard.errors, value: compact(errors), color: LEVEL_HEX.Error, tone: 'error' },
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

          <MetricCard
            eyebrow={t.dashboard.errors}
            value={compact(errors)}
            icon="exceptions"
            plate="error"
            breakdown={[
              { label: t.dashboard.rate, value: `${errorRate.toFixed(1)}%`, tone: errorRate > 0 ? 'error' : 'default' },
              { label: t.dashboard.fatal, value: compact(byLevel?.Fatal ?? 0), color: LEVEL_HEX.Fatal, tone: 'error' },
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
      </section>

      {/* Analysis: what is failing and what is slow */}
      <section>
        <SectionHeader title={t.analysis.title} to="/analysis" linkLabel={t.dashboard.viewAll} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TopErrorsPanel errors={topErrors.data?.errors ?? []} from={range.from} to={range.to} />
          <ExceptionsPanel exceptions={topExceptions.data?.exceptions ?? []} />
          <RoutesPanel operations={operations.data?.operations ?? []} from={range.from} to={range.to} />
          <SlowOpsPanel result={slow.data} from={range.from} to={range.to} />
        </div>
      </section>

      {/* Who and where: services and the users behind the traffic */}
      <section>
        <SectionHeader title={t.dashboard.servicesUsers} />
        <div className="grid gap-4 lg:grid-cols-2">
          <ServicesPanel services={(services.data?.services ?? []).slice(0, PANEL_LIMIT)} from={range.from} to={range.to} />
          <UsersPanel users={users.data?.users ?? []} from={range.from} to={range.to} />
        </div>
      </section>

      <section>
        <SectionHeader title={t.dashboard.activityByHour} />
        <Card className="p-4">
          {heatmap.isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
          {heatmap.data && (
            <div className={heatmap.isFetching ? 'opacity-60 transition-opacity' : ''}>
              <Heatmap cells={heatmap.data.cells} />
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}
