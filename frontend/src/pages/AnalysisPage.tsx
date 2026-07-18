import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TopError } from '../types'
import { useSlowOperations, useTopErrors, useTopExceptions } from '../hooks/useStats'
import { LevelBadge } from '../components/LevelBadge'
import { Sparkline } from '../components/Sparkline'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const DEFAULT_RANGE_HOURS = 24
const ROW_LIMIT = 20
// baseline window start: anything before this predates the server itself
const BASELINE_START = '2000-01-01T00:00:00.000Z'
// the frontend never overrides the endpoint's `property` default, so the timed message names it
const SLOW_PROPERTY = 'Elapsed'

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

/** ms with locale thousands grouping: 2559 -> "2.559 ms" (tr) / "2,559 ms" (en). */
function formatMs(ms: number, locale: string): string {
  return `${Math.round(ms).toLocaleString(locale)} ms`
}

export function AnalysisPage() {
  const { t, lang } = useI18n()
  const [range, setRange] = useState(defaultRange)
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
    navigate(`/?${params.toString()}`)
  }

  const queryError = errors.error ?? exceptions.error ?? slow.error

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.analysis.title}</h1>
        <TimeRangePicker
          from={range.from}
          to={range.to}
          onChange={(next) => {
            // presets leave `to` open-ended; this page compares two closed windows, so pin it to now
            if (next.from) setRange({ from: next.from, to: next.to ?? new Date().toISOString() })
          }}
        />
      </div>

      {queryError && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queryError.message}</p>}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">{t.analysis.topErrors}</h2>
        <Card className="overflow-x-auto">
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
                      color={LEVEL_HEX[row.level]}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.data?.errors.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">{t.analysis.noErrors}</p>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">{t.analysis.topExceptions}</h2>
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>{t.analysis.exceptionType}</th>
                <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
                <th className={TH_CLASS}>{t.analysis.firstSeen}</th>
                <th className={TH_CLASS}>{t.analysis.lastSeen}</th>
              </tr>
            </thead>
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
          </table>
          {exceptions.data?.exceptions.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">{t.analysis.noExceptions}</p>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">{t.analysis.slowerThanUsual}</h2>
        <Card className="overflow-x-auto">
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
            <tbody>
              {(slow.data?.operations ?? []).map((op) => (
                <tr
                  key={op.template}
                  onClick={() =>
                    navigate(
                      `/?${new URLSearchParams({ from: range.from, to: range.to, filter: `@MessageTemplate = ${quote(op.template)}` }).toString()}`,
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
                      color={LEVEL_HEX.Warning}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {slow.data && slow.data.operations.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">
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
        </Card>
      </section>
    </div>
  )
}
