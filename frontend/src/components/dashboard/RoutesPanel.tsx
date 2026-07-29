import { useNavigate } from 'react-router-dom'
import type { OperationOverview } from '../../types'
import { useI18n } from '../../i18n'
import { operationFilter } from '../../lib/operations'
import { formatDuration } from '../../lib/duration'
import { PulsePanel } from './PulsePanel'

/** Where a route stops being fast. Not configurable yet: one number the whole panel is read
 *  against beats a per-row judgement nobody has calibrated. */
const SLOW_MS = 1000

/** The verb decides the colour, so a write standing out among reads is visible before reading
 *  a single path. Level hues, so both themes and their contrast floor still hold. */
const METHOD_CLASS: Record<string, string> = {
  GET: 'text-level-information',
  HEAD: 'text-level-information',
  OPTIONS: 'text-fg-muted',
  POST: 'text-accent',
  PUT: 'text-level-verbose',
  PATCH: 'text-level-verbose',
  DELETE: 'text-level-error',
}

/** The server groups by the route property when the events carry one and hands back the verb and
 *  path apart; a template group (a job, a heartbeat) arrives with both null and is shown whole. */
function routeOf(op: OperationOverview): { method: string | null; path: string } {
  return op.route === null ? { method: null, path: op.template } : { method: op.method, path: op.route }
}

interface RoutesPanelProps {
  operations: OperationOverview[]
  from: string
  to: string
}

// "Routes" in the Nightwatch sense: the busiest operations (message templates) with their
// p95 latency. Operations are already ordered by volume by /api/stats/operations.
export function RoutesPanel({ operations, from, to }: RoutesPanelProps) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  // a route group is not a template, so the deep link has to filter on the same properties the
  // grouping used — filtering by the template would open every route the app serves
  function openEvents(op: OperationOverview) {
    const params = new URLSearchParams({ from, to, filter: operationFilter(op) })
    navigate(`/events?${params.toString()}`)
  }

  const slow = operations.filter((op) => op.p95ElapsedMs !== null && op.p95ElapsedMs >= SLOW_MS).length
  const limit = formatDuration(SLOW_MS, lang)
  // counted over the rows on screen, and worded that way: this panel holds the busiest few,
  // not every route the server has seen
  const lead = (
    <p className="text-sm font-semibold text-fg">
      {slow > 0
        ? t.dashboard.routesOver(slow, operations.length, limit)
        : t.dashboard.routesAllUnder(operations.length, limit)}
    </p>
  )

  return (
    <PulsePanel
      title={t.dashboard.routes}
      to="/requests"
      isEmpty={operations.length === 0}
      emptyText={t.analysis.noOperations}
      lead={lead}
      cards
    >
      {operations.map((op) => {
        const { method, path } = routeOf(op)
        const isSlow = op.p95ElapsedMs !== null && op.p95ElapsedMs >= SLOW_MS
        return (
          <li key={op.template}>
            <button
              type="button"
              onClick={() => openEvents(op)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-inset px-3 py-2 text-left transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover"
            >
              <span className="min-w-0">
                {method && (
                  <span
                    className={`block font-mono text-xs font-semibold ${METHOD_CLASS[method.toUpperCase()] ?? 'text-fg-muted'}`}
                  >
                    {method}
                  </span>
                )}
                <span className="block truncate font-mono text-sm text-fg-muted">{path}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span className="text-[0.625rem] tracking-wider text-fg-subtle uppercase">{t.dashboard.p95}</span>
                <span className={`tabular text-sm font-medium ${isSlow ? 'text-level-warning' : 'text-fg'}`}>
                  {formatDuration(op.p95ElapsedMs, lang)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </PulsePanel>
  )
}
