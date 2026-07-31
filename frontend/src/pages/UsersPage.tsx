import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUserActivity } from '../hooks/useStats'
import { TrendBars } from '../components/Sparkline'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { formatTimestamp } from '../lib/dates'
import { propertyEquals } from '../lib/filter'
import { SERIES } from '../lib/series'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50
const DEFAULT_PROPERTY = 'UserId'
// columns in each row's trend strip, sent down with the rows. Fifty rows used to mean fifty
// histogram requests, none of which could start until this page's own query had answered.
const TREND_BUCKETS = 24

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'
const INPUT_CLASS =
  'w-32 rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none'

export function UsersPage() {
  const { t, lang } = useI18n()
  // the app's one window: whatever range the reader picked on any page, they still have here
  const { live, range, toggleLive, setRange } = useLiveRange()
  const [property, setProperty] = useState(DEFAULT_PROPERTY)
  const navigate = useNavigate()

  const users = useUserActivity({ ...range, property, limit: ROW_LIMIT, trendBuckets: TREND_BUCKETS })

  function openEvents(value: string) {
    const params = new URLSearchParams({ from: range.from, to: range.to, filter: propertyEquals(property, value) })
    navigate(`/events?${params.toString()}`)
  }

  function applyProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new FormData(event.currentTarget).get('property')
    if (typeof next === 'string' && next.trim()) setProperty(next.trim())
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t.users.title}</h1>
        <div className="flex items-center gap-2">
          <form onSubmit={applyProperty}>
            <input
              name="property"
              defaultValue={property}
              aria-label={t.users.property}
              title={t.users.property}
              className={INPUT_CLASS}
            />
          </form>
          <LiveRangeControls
            live={live}
            onToggleLive={toggleLive}
            from={range.from}
            to={range.to}
            onRangeChange={setRange}
          />
        </div>
      </div>

      {users.error && <p className="bg-level-error/10 p-2 text-sm text-level-error">{users.error.message}</p>}

      {/* headerless: the h1 above already names the one table on this page */}
      <SectionBlock>
        <Panel className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.users.user}</th>
              <th className={`${TH_CLASS} text-right`}>{t.users.events}</th>
              <th className={`${TH_CLASS} text-right`}>{t.users.errors}</th>
              <th className={TH_CLASS}>{t.users.lastSeen}</th>
              <th className={TH_CLASS}>{t.users.trend}</th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.users ?? []).map((row) => {
              const errorPct = row.total > 0 ? (row.errorCount / row.total) * 100 : 0
              return (
                <tr
                  key={row.value}
                  onClick={() => openEvents(row.value)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{row.value}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.total.toLocaleString(lang)}</td>
                  <td className={`${TD_CLASS} tabular text-right ${errorPct > 0 ? 'text-level-error' : ''}`}>
                    {errorPct.toFixed(1)}%
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
                  <td className={TD_CLASS}>
                    <TrendBars values={row.trend ?? []} color={SERIES.volume} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
          {users.data?.users.length === 0 && <p className="p-3 text-sm text-fg-muted">{t.users.empty(property)}</p>}
        </Panel>
      </SectionBlock>
    </div>
  )
}
