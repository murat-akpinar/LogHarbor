import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUserActivity } from '../hooks/useStats'
import { Sparkline } from '../components/Sparkline'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const DEFAULT_RANGE_HOURS = 24
const ROW_LIMIT = 50
const DEFAULT_PROPERTY = 'UserId'

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'
const INPUT_CLASS =
  'w-32 rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none'

// numeric ids compare as numbers in SQLite; strings need a quoted literal. Emit the matching form
// so the deep link (and sparkline) works whether the property holds "user-42" or 42.
function propertyEquals(property: string, value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) ? `${property} = ${value}` : `${property} = ${quote(value)}`
}

export function UsersPage() {
  const { t, lang } = useI18n()
  const [range, setRange] = useState(defaultRange)
  const [property, setProperty] = useState(DEFAULT_PROPERTY)
  const navigate = useNavigate()

  const users = useUserActivity({ ...range, property, limit: ROW_LIMIT })

  function openEvents(value: string) {
    const params = new URLSearchParams({ from: range.from, to: range.to, filter: propertyEquals(property, value) })
    navigate(`/?${params.toString()}`)
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
          <TimeRangePicker
            from={range.from}
            to={range.to}
            onChange={(next) => {
              // presets leave `to` open-ended; the query needs a closed window, so pin it to now
              if (next.from) setRange({ from: next.from, to: next.to ?? new Date().toISOString() })
            }}
          />
        </div>
      </div>

      {users.error && <p className="bg-level-error/10 p-2 text-sm text-level-error">{users.error.message}</p>}

      <Card className="overflow-x-auto">
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
                    <Sparkline
                      filter={propertyEquals(property, row.value)}
                      color={errorPct > 0 ? LEVEL_HEX.Error : LEVEL_HEX.Information}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {users.data?.users.length === 0 && <p className="p-3 text-sm text-fg-muted">{t.users.empty(property)}</p>}
      </Card>
    </div>
  )
}
