import { useNavigate } from 'react-router-dom'
import type { UserActivity } from '../../types'
import { useI18n } from '../../i18n'
import { quote } from '../../lib/filter'
import { PulsePanel, PulseRow } from './PulsePanel'

interface UsersPanelProps {
  users: UserActivity[]
  from: string
  to: string
}

const USER_PROPERTY = 'UserId'

// numeric ids compare as numbers, strings as quoted literals (mirrors UsersPage)
function userFilter(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) ? `${USER_PROPERTY} = ${value}` : `${USER_PROPERTY} = ${quote(value)}`
}

export function UsersPanel({ users, from, to }: UsersPanelProps) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  function openEvents(value: string) {
    const params = new URLSearchParams({ from, to, filter: userFilter(value) })
    navigate(`/events?${params.toString()}`)
  }

  return (
    <PulsePanel title={t.nav.users} to="/users" isEmpty={users.length === 0} emptyText={t.users.empty(USER_PROPERTY)}>
      {users.map((row) => {
        const errorPct = row.total > 0 ? (row.errorCount / row.total) * 100 : 0
        return (
          <PulseRow
            key={row.value}
            onClick={() => openEvents(row.value)}
            left={<span className="truncate font-mono text-sm text-fg">{row.value}</span>}
            right={
              <span className={errorPct > 0 ? 'text-level-error' : 'text-fg-muted'}>{row.total.toLocaleString(lang)}</span>
            }
          />
        )
      })}
    </PulsePanel>
  )
}
