import { Fragment, useState } from 'react'
import { useTopExceptions } from '../hooks/useStats'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { ExceptionContextPanel } from '../components/exceptions/ExceptionContextPanel'
import { Sparkline } from '../components/Sparkline'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { exceptionStartsWith } from '../lib/filter'
import { LEVEL_CHART } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

export function ExceptionsPage() {
  const { t, lang } = useI18n()
  const { live, range, toggleLive, setRange } = useLiveRange()
  const [expandedType, setExpandedType] = useState<string | null>(null)

  const exceptions = useTopExceptions({ ...range, limit: ROW_LIMIT })
  const rows = exceptions.data?.exceptions ?? []
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t.exceptions.title}</h1>
        <div className="flex items-center gap-2">
          <LiveRangeControls
            live={live}
            onToggleLive={toggleLive}
            from={range.from}
            to={range.to}
            onRangeChange={setRange}
          />
        </div>
      </div>

      {exceptions.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{exceptions.error.message}</p>
      )}

      {exceptions.data && <p className="text-xl font-semibold text-fg">{t.exceptions.headline(total)}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.analysis.exceptionType}</th>
              <th className={TH_CLASS}>{t.exceptions.source}</th>
              <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
              <th className={TH_CLASS}>{t.analysis.trend}</th>
              <th className={TH_CLASS}>{t.analysis.firstSeen}</th>
              <th className={TH_CLASS}>{t.analysis.lastSeen}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.type}>
                <tr
                  onClick={() => setExpandedType(expandedType === row.type ? null : row.type)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{row.type}</td>
                  <td className={`${TD_CLASS} max-w-48 truncate font-mono text-xs text-fg-muted`} title={row.location ?? undefined}>
                    {row.location ?? '—'}
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.count.toLocaleString(lang)}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={exceptionStartsWith(row.type)}
                      color={LEVEL_CHART.Error}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
                </tr>
                {expandedType === row.type && (
                  <tr className="border-b border-border last:border-b-0">
                    <td colSpan={6} className="p-0">
                      <ExceptionContextPanel type={row.type} from={range.from} to={range.to} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {exceptions.data && rows.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">{t.analysis.noExceptions}</p>
        )}
      </Card>
    </div>
  )
}
