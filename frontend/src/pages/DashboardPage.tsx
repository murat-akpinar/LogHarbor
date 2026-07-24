import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useHeatmap,
  useHistogram,
  useServices,
  useSlowOperations,
  useSummary,
  useTopErrors,
  useTopExceptions,
} from '../hooks/useStats'
import { KpiRow } from '../components/dashboard/KpiRow'
import { LiveToggle } from '../components/dashboard/LiveToggle'
import { TopErrorsPanel } from '../components/dashboard/TopErrorsPanel'
import { ExceptionsPanel } from '../components/dashboard/ExceptionsPanel'
import { ServicesPanel } from '../components/dashboard/ServicesPanel'
import { SlowOpsPanel } from '../components/dashboard/SlowOpsPanel'
import { Histogram } from '../components/Histogram'
import { Heatmap } from '../components/Heatmap'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { useI18n } from '../i18n'

const BUCKET_COUNT = 24
const PANEL_LIMIT = 5
const REFRESH_MS = 10_000
const LIVE_WINDOW_MS = 60 * 60 * 1000 // rolling last hour

// floor to the refresh interval so the query keys (and histogram buckets) stay stable within a tick
function flooredNow() {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

export function DashboardPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [live, setLive] = useState(true)
  const [now, setNow] = useState(flooredNow)
  // the window to hold while paused; null until the user pauses or brushes
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
      pause(range) // freeze on the window currently shown
    } else {
      setNow(flooredNow())
      setFrozen(null)
      setLive(true)
    }
  }

  const summary = useSummary(range)
  const histogram = useHistogram({ ...range, buckets: BUCKET_COUNT })
  const heatmap = useHeatmap(range)
  const topErrors = useTopErrors({ ...range, limit: PANEL_LIMIT })
  const topExceptions = useTopExceptions({ ...range, limit: PANEL_LIMIT })
  const services = useServices({ ...range, limit: PANEL_LIMIT })
  const slow = useSlowOperations({ ...range, limit: PANEL_LIMIT })

  const windowMinutes = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000
  const queryError = summary.error ?? histogram.error

  function goToEvents(from: string, to: string) {
    navigate(`/?${new URLSearchParams({ from, to }).toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t.dashboard.title}</h1>
        <div className="flex items-center gap-2">
          <LiveToggle live={live} onToggle={toggleLive} />
          {!live && (
            <TimeRangePicker
              from={range.from}
              to={range.to}
              onChange={(next) => {
                // presets leave `to` open-ended; the stats queries need a closed range, so pin it to now
                if (next.from) pause({ from: next.from, to: next.to ?? new Date().toISOString() })
              }}
            />
          )}
        </div>
      </div>

      {queryError && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queryError.message}</p>}

      <KpiRow summary={summary.data} windowMinutes={windowMinutes} />

      <Card className="p-4">
        {histogram.isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
        {histogram.data && (
          <div className={histogram.isFetching ? 'opacity-60 transition-opacity' : ''}>
            <Histogram
              buckets={histogram.data.buckets}
              rangeEnd={range.to}
              onBucketClick={goToEvents}
              onBrush={(from, to) => pause({ from, to })}
            />
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <TopErrorsPanel errors={topErrors.data?.errors ?? []} from={range.from} to={range.to} />
        <ExceptionsPanel exceptions={topExceptions.data?.exceptions ?? []} />
        <ServicesPanel services={services.data?.services ?? []} from={range.from} to={range.to} />
        <SlowOpsPanel result={slow.data} from={range.from} to={range.to} />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.dashboard.activityByHour}</h2>
        {heatmap.isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
        {heatmap.data && (
          <div className={heatmap.isFetching ? 'opacity-60 transition-opacity' : ''}>
            <Heatmap cells={heatmap.data.cells} />
          </div>
        )}
      </Card>
    </div>
  )
}
