import { useNavigate } from 'react-router-dom'
import type { TopError } from '../types'
import { useSlowOperations, useTopErrors, useTopExceptions } from '../hooks/useStats'
import { LevelBadge } from '../components/LevelBadge'
import { Sparkline } from '../components/Sparkline'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { EmptyState, ErrorState, TableSkeletonBody } from '../components/ui/States'
import { formatTimestamp } from '../lib/dates'
import { quote } from '../lib/filter'
import { LEVEL_CHART } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 20
// baseline window start: anything before this predates the server itself
const BASELINE_START = '2000-01-01T00:00:00.000Z'
// the frontend never overrides the endpoint's `property` default, so the timed message names it
const SLOW_PROPERTY = 'Elapsed'

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

/** ms with locale thousands grouping: 2559 -> "2.559 ms" (tr) / "2,559 ms" (en). */
function formatMs(ms: number, locale: string): string {
  return `${Math.round(ms).toLocaleString(locale)} ms`
}

export function AnalysisPage() {
  const { t, lang } = useI18n()
  // the app's one window: whatever range the reader picked on any page, they still have here
  const { live, range, presetKey, toggleLive, setRange, setPreset } = useLiveRange()
  const navigate = useNavigate()

  const errors = useTopErrors({ ...range, limit: ROW_LIMIT })
  const exceptions = useTopExceptions({ ...range, limit: ROW_LIMIT })
  const slow = useSlowOperations({ ...range, limit: ROW_LIMIT })
  // an error group is "new" when it never occurred before the selected range
  // ponytail: baseline is capped at the top 100 groups; rare templates beyond it flag as new
  const baseline = useTopErrors({ from: BASELINE_START, to: range.from, limit: 100 })
  const knownGroups = new Set((baseline.data?.errors ?? []).map((row) => `${row.level}\n${row.template}`))

  function isNew(row: TopError): boolean {
    return baseline.data !== undefined && !knownGroups.has(`${row.level}\n${row.template}`)
  }

  function openEvents(row: TopError) {
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      filter: `@MessageTemplate = ${quote(row.template)}`,
    })
    navigate(`/events?${params.toString()}`)
  }

  const queryError = errors.error ?? exceptions.error ?? slow.error

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.analysis.title}</h1>
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

      {queryError && (
        <ErrorState
          message={queryError.message}
          onRetry={() => {
            // one line for three queries, so the button has to reach all three: whichever
            // failed is the one with something to retry, and a healthy query refetching costs
            // one request
            void errors.refetch()
            void exceptions.refetch()
            void slow.refetch()
          }}
        />
      )}

      <SectionBlock icon="exceptions" title={t.analysis.topErrors} meta={(errors.data?.errors.length ?? 0).toLocaleString(lang)}>
        <Panel className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>{t.analysis.messageTemplate}</th>
                <th className={TH_CLASS}>{t.analysis.level}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
                <th className={TH_CLASS}>{t.analysis.trend}</th>
                <th className={TH_CLASS}>{t.analysis.firstSeen}</th>
                <th className={TH_CLASS}>{t.analysis.lastSeen}</th>
              </tr>
            </thead>
            {errors.isPending ? (
              <TableSkeletonBody columns={6} />
            ) : (
            <tbody>
              {(errors.data?.errors ?? []).map((row) => (
                <tr
                  key={`${row.level}\n${row.template}`}
                  onClick={() => openEvents(row)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>
                    {row.template}
                    {isNew(row) && (
                      <span className="ml-2 rounded border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
                        {t.analysis.newBadge}
                      </span>
                    )}
                  </td>
                  <td className={TD_CLASS}>
                    <LevelBadge level={row.level} />
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.count}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@Level = '${row.level}' and @MessageTemplate = ${quote(row.template)}`}
                      color={LEVEL_CHART[row.level]}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
                </tr>
              ))}
            </tbody>
            )}
          </table>
          {errors.data?.errors.length === 0 && <EmptyState icon="exceptions" title={t.analysis.noErrors} />}
        </Panel>
      </SectionBlock>

      <SectionBlock
        icon="exceptions"
        title={t.analysis.topExceptions}
        meta={(exceptions.data?.exceptions.length ?? 0).toLocaleString(lang)}
        to="/exceptions"
        linkLabel={t.dashboard.viewAll}
      >
        <Panel className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>{t.analysis.exceptionType}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
                <th className={TH_CLASS}>{t.analysis.firstSeen}</th>
                <th className={TH_CLASS}>{t.analysis.lastSeen}</th>
              </tr>
            </thead>
            {exceptions.isPending ? (
              <TableSkeletonBody columns={4} />
            ) : (
            <tbody>
              {(exceptions.data?.exceptions ?? []).map((row) => (
                <tr key={row.type} className="border-b border-border last:border-b-0">
                  <td className={`${TD_CLASS} font-mono`}>{row.type}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.count}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
                </tr>
              ))}
            </tbody>
            )}
          </table>
          {exceptions.data?.exceptions.length === 0 && (
            <EmptyState icon="exceptions" title={t.analysis.noExceptions} />
          )}
        </Panel>
      </SectionBlock>

      <SectionBlock
        icon="analysis"
        title={t.analysis.slowerThanUsual}
        meta={(slow.data?.operations.length ?? 0).toLocaleString(lang)}
        to="/requests"
        linkLabel={t.dashboard.viewAll}
      >
        <Panel className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>{t.analysis.operation}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.usualP95}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.nowP95}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.slowerFactor}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
                <th className={TH_CLASS}>{t.analysis.trend}</th>
              </tr>
            </thead>
            {slow.isPending ? (
              <TableSkeletonBody columns={5} />
            ) : (
            <tbody>
              {(slow.data?.operations ?? []).map((op) => (
                <tr
                  key={op.template}
                  onClick={() =>
                    navigate(
                      `/events?${new URLSearchParams({ from: range.from, to: range.to, filter: `@MessageTemplate = ${quote(op.template)}` }).toString()}`,
                    )
                  }
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{op.template}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatMs(op.baselineP95, lang)}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatMs(op.currentP95, lang)}</td>
                  <td className={`${TD_CLASS} tabular text-right font-medium text-level-warning`}>
                    {(op.currentP95 / op.baselineP95).toFixed(1)}×
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{op.count}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@MessageTemplate = ${quote(op.template)}`}
                      color={LEVEL_CHART.Warning}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            )}
          </table>
          {slow.data && slow.data.operations.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-fg-muted">
              {slow.data.timedOperationCount === 0 ? (
                <>
                  {t.analysis.noTimedOpsBefore}
                  <span className="font-mono">{SLOW_PROPERTY}</span>
                  {t.analysis.noTimedOpsAfter}
                </>
              ) : slow.data.comparableOperationCount === 0 ? (
                t.analysis.noBaselineToCompare
              ) : (
                t.analysis.noSlowOps
              )}
            </p>
          )}
        </Panel>
      </SectionBlock>
    </div>
  )
}
