import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useHeatmap, useHistogram, useSummary, useTopErrors } from '../hooks/useStats'
import { StatTile } from '../components/StatTile'
import { Histogram } from '../components/Histogram'
import { Heatmap } from '../components/Heatmap'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'

const BUCKET_COUNT = 24
const DEFAULT_RANGE_HOURS = 24

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function DashboardPage() {
  const [range, setRange] = useState(defaultRange)
  const navigate = useNavigate()

  const summary = useSummary(range)
  const histogram = useHistogram({ ...range, buckets: BUCKET_COUNT })
  const heatmap = useHeatmap(range)
  const topErrors = useTopErrors({ ...range, limit: 1 })
  const topError = topErrors.data?.errors[0]

  const rangeParams = useMemo(
    () => ({ from: range.from, to: range.to }) as { from: string | undefined; to: string | undefined },
    [range],
  )

  function goToEvents(from: string, to: string) {
    const params = new URLSearchParams({ from, to })
    navigate(`/?${params.toString()}`)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">Dashboard</h1>
        <TimeRangePicker
          from={rangeParams.from}
          to={rangeParams.to}
          onChange={(next) => {
            if (next.from && next.to) setRange({ from: next.from, to: next.to })
          }}
        />
      </div>

      {(summary.error ?? histogram.error) && (
        <p className="mb-4 bg-level-error/10 p-2 text-sm text-level-error">
          {(summary.error ?? histogram.error)?.message}
        </p>
      )}

      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatTile label="Total events" value={summary.data?.total ?? 0} />
        <StatTile label="Errors" value={summary.data?.byLevel.Error ?? 0} tone="Error" />
        <StatTile label="Warnings" value={summary.data?.byLevel.Warning ?? 0} tone="Warning" />
        <Link to="/analysis" className="block h-full">
          <Card className="h-full px-4 py-3 transition-colors duration-150 hover:bg-surface-hover">
            <p className="text-xs text-fg-muted">Top error</p>
            <p className="truncate font-mono text-sm text-level-error" title={topError?.template}>
              {topError ? topError.template : 'None in range'}
            </p>
            {topError && <p className="mt-1 text-xs text-fg-muted">{topError.count}× — open Analysis</p>}
          </Card>
        </Link>
      </div>

      <Card className="p-4">
        {histogram.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
        {histogram.data && (
          <div className={histogram.isFetching ? 'opacity-60 transition-opacity' : ''}>
            <Histogram
              buckets={histogram.data.buckets}
              rangeEnd={range.to}
              onBucketClick={goToEvents}
              onBrush={(from, to) => setRange({ from, to })}
            />
          </div>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">Activity by hour (UTC)</h2>
        {heatmap.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
        {heatmap.data && (
          <div className={heatmap.isFetching ? 'opacity-60 transition-opacity' : ''}>
            <Heatmap cells={heatmap.data.cells} />
          </div>
        )}
      </Card>
    </div>
  )
}
