import { useState } from 'react'
import type { FormEvent } from 'react'
import { useCreateUser, useDeleteUser, useUsers } from '../../hooks/useUsers'
import { formatTimestamp } from '../../lib/dates'
import type { UserRole } from '../../types'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { useI18n } from '../../i18n'

const TH_CLASS = 'pb-2 font-medium'
const TD_CLASS = 'py-2 text-fg'

const ROLES: UserRole[] = ['viewer', 'admin']

export function UsersCard() {
  const { t, lang } = useI18n()
  const { data: users, isLoading, error } = useUsers()
  const createUser = useCreateUser()
  const deleteUser = useDeleteUser()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('viewer')
  const [formError, setFormError] = useState<string | null>(null)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    try {
      await createUser.mutateAsync({ username: username.trim(), password, role })
      setUsername('')
      setPassword('')
      setRole('viewer')
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : t.settings.couldNotCreateUser)
    }
  }

  return (
    <div>
      <form onSubmit={handleCreate} className="mb-3 flex flex-wrap gap-2">
        <Input type="text" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t.settings.username} />
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t.settings.password}
        />
        <Select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={createUser.isPending}>
          {t.settings.createUser}
        </Button>
      </form>

      {formError && <p className="mb-3 text-xs text-level-error">{formError}</p>}

      {isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
      {error && <p className="text-sm text-level-error">{error.message}</p>}
      {users && users.length === 0 && <p className="text-sm text-fg-muted">{t.settings.noUsers}</p>}

      {users && users.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-muted">
              <th className={TH_CLASS}>{t.settings.username}</th>
              <th className={TH_CLASS}>{t.settings.role}</th>
              <th className={TH_CLASS}>{t.settings.colLastLogin}</th>
              <th className={TH_CLASS}>{t.settings.colCreated}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={`${user.source}:${user.username}`} className="border-b border-border last:border-b-0">
                <td className={TD_CLASS}>
                  <span className="flex items-center gap-2">
                    {user.username}
                    {user.source === 'ldap' && (
                      <span
                        title={t.settings.directoryRowHint}
                        className="rounded border border-accent/30 bg-accent/12 px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide text-accent"
                      >
                        {t.settings.directoryBadge}
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 text-fg-muted">{user.role}</td>
                <td className="py-2 text-xs text-fg-muted">
                  {user.lastLoginAt ? formatTimestamp(user.lastLoginAt, lang) : t.settings.neverSignedIn}
                </td>
                <td className="py-2 text-xs text-fg-muted">{formatTimestamp(user.createdAt, lang)}</td>
                <td className="py-2 text-right">
                  {/* a directory row is a record of a sign-in, not an account: there is nothing
                      here to revoke, and deleting it would only forget when they last came in */}
                  {user.id !== null && (
                    <Button variant="danger" onClick={() => deleteUser.mutate(user.id!)} disabled={deleteUser.isPending}>
                      {t.common.delete}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {deleteUser.error && <p className="mt-2 text-xs text-level-error">{deleteUser.error.message}</p>}
    </div>
  )
}

/** One titled area inside a tab, in the app's plate-and-well language: the tab already says
 *  which part of settings this is, so the heading only has to name the area itself. */
