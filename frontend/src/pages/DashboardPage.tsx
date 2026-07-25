import { Link, useNavigate } from 'react-router-dom'
import {
  useHeatmap,
  useHistogram,
  useIngestionLag,
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
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const BUCKET_COUNT = 24
const PANEL_LIMIT = 5
const ERROR_FILTER = "@Level = 'Error' or @Level = 'Fatal'"

export function DashboardPage() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { live, range, toggleLive, setRange } = useLiveRange()

  const summary = useSummary(range)
  const histogram = useHistogram({ ...range, buckets: BUCKET_COUNT })
  const errorHistogram = useHistogram({ ...range, buckets: BUCKET_COUNT, filter: ERROR_FILTER })
  const heatmap = useHeatmap(range)
  const ingestionLag = useIngestionLag(range)
  const topErrors = useTopErrors({ ...range, limit: PANEL_LIMIT })
  const topExceptions = useTopExceptions({ ...range, limit: PANEL_LIMIT })
  const services = useServices({ ...range, limit: PANEL_LIMIT })
  const slow = useSlowOperations({ ...range, limit: PANEL_LIMIT })
  const operations = useOperations({ ...range, limit: PANEL_LIMIT })
  const users = useUserActivity({ ...range, property: 'UserId', limit: PANEL_LIMIT })

  const byLevel = summary.data?.byLevel
  const total = summary.data?.total ?? 0
  const errors = (byLevel?.Error ?? 0) + (byLevel?.Fatal ?? 0)
  const errorRate = total > 0 ? (errors / total) * 100 : 0
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
          <ServicesPanel services={services.data?.services ?? []} from={range.from} to={range.to} />
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
