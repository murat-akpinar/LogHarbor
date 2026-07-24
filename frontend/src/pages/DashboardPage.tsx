import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  useHeatmap,
  useHistogram,
  useServices,
  useSlowOperations,
  useSummary,
  useTopErrors,
  useTopExceptions,
  useUserActivity,
} from '../hooks/useStats'
import { MetricCard } from '../components/dashboard/MetricCard'
import { SectionHeader } from '../components/dashboard/SectionHeader'
import { LiveToggle } from '../components/dashboard/LiveToggle'
import { TopErrorsPanel } from '../components/dashboard/TopErrorsPanel'
import { ExceptionsPanel } from '../components/dashboard/ExceptionsPanel'
import { ServicesPanel } from '../components/dashboard/ServicesPanel'
import { SlowOpsPanel } from '../components/dashboard/SlowOpsPanel'
import { UsersPanel } from '../components/dashboard/UsersPanel'
import { Histogram } from '../components/Histogram'
import { Heatmap } from '../components/Heatmap'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const BUCKET_COUNT = 24
const PANEL_LIMIT = 5
const REFRESH_MS = 10_000
const LIVE_WINDOW_MS = 60 * 60 * 1000 // rolling last hour
const ERROR_FILTER = "@Level = 'Error' or @Level = 'Fatal'"

// floor to the refresh interval so the query keys (and histogram buckets) stay stable within a tick
function flooredNow() {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

export function DashboardPage() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [live, setLive] = useState(true)
  const [now, setNow] = useState(flooredNow)
  const [frozen, setFrozen] = useState<{ from: string; to: string } | null>(null)

  const liveRange = useMemo(
    () => ({ from: new Date(now - LIVE_WINDOW_MS).toISOString(), to: new Date(now).toISOString() }),
    [now],
  )
  const range = live ? liveRange : (frozen ?? liveRange)

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [live])

  function pause(on: { from: string; to: string }) {
    setFrozen(on)
    setLive(false)
  }

  function toggleLive() {
    if (live) {
      pause(range)
    } else {
      setNow(flooredNow())
      setFrozen(null)
      setLive(true)
    }
  }

  const summary = useSummary(range)
  const histogram = useHistogram({ ...range, buckets: BUCKET_COUNT })
  const errorHistogram = useHistogram({ ...range, buckets: BUCKET_COUNT, filter: ERROR_FILTER })
  const heatmap = useHeatmap(range)
  const topErrors = useTopErrors({ ...range, limit: PANEL_LIMIT })
  const topExceptions = useTopExceptions({ ...range, limit: PANEL_LIMIT })
  const services = useServices({ ...range, limit: PANEL_LIMIT })
  const slow = useSlowOperations({ ...range, limit: PANEL_LIMIT })
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
        <div className="flex items-center gap-2">
          <LiveToggle live={live} onToggle={toggleLive} />
          {!live && (
            <TimeRangePicker
              from={range.from}
              to={range.to}
              onChange={(next) => {
                if (next.from) pause({ from: next.from, to: next.to ?? new Date().toISOString() })
              }}
            />
          )}
        </div>
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
                  onBrush={(from, to) => pause({ from, to })}
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
                  onBrush={(from, to) => pause({ from, to })}
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
        <div className="grid gap-4 lg:grid-cols-3">
          <TopErrorsPanel errors={topErrors.data?.errors ?? []} from={range.from} to={range.to} />
          <ExceptionsPanel exceptions={topExceptions.data?.exceptions ?? []} />
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
