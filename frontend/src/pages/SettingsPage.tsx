import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getArchiveSegments, getArchiveSettings, saveArchiveSettings } from '../api/archive'
import { createApiKey, getApiKeys, getHealth, revokeApiKey } from '../api/settings'
import { useAuthStatus, useIsAdmin, useLogout } from '../hooks/useAuth'
import { useCreateUser, useDeleteUser, useUsers } from '../hooks/useUsers'
import { formatTimestamp } from '../lib/dates'
import type { CreatedApiKey, UserRole } from '../types'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'
import { useI18n } from '../i18n'

const API_KEYS_KEY = ['apikeys']
const ARCHIVE_SETTINGS_KEY = ['archive-settings']
const ARCHIVE_SEGMENTS_KEY = ['archive-segments']

const TH_CLASS = 'pb-2 font-medium'
const TD_CLASS = 'py-2 text-fg'

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function HealthCard() {
  const { t, lang } = useI18n()
  const { data: health, error } = useQuery({ queryKey: ['health'], queryFn: getHealth })

  if (error) {
    return <p className="text-sm text-level-error">{error.message}</p>
  }
  return (
    <dl className="grid grid-cols-3 gap-4 text-sm">
      <div>
        <dt className="text-xs text-fg-muted">{t.settings.status}</dt>
        <dd className="text-fg">{health?.status ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-fg-muted">{t.settings.events}</dt>
        <dd className="tabular text-fg">{health?.eventCount.toLocaleString(lang) ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-fg-muted">{t.settings.dbSize}</dt>
        <dd className="tabular text-fg">{health ? formatBytes(health.dbSizeBytes) : '—'}</dd>
      </div>
    </dl>
  )
}

function ApiKeysCard() {
  const { t, lang } = useI18n()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  const { data: keys, isLoading, error } = useQuery({ queryKey: API_KEYS_KEY, queryFn: getApiKeys })
  const [title, setTitle] = useState('')
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)

  const create = useMutation({
    mutationFn: (newTitle: string) => createApiKey(newTitle),
    onSuccess: (created) => {
      setCreatedKey(created)
      setTitle('')
      return queryClient.invalidateQueries({ queryKey: API_KEYS_KEY })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: number) => revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: API_KEYS_KEY }),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    // the title is only a label for telling keys apart later, so an empty one still creates a key
    const fallback = `key-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    create.mutate(title.trim() || fallback)
  }

  return (
    <div>
      {isAdmin && (
        <form onSubmit={handleCreate} className="mb-3 flex gap-2">
          <Input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t.settings.keyTitlePlaceholder}
            mono
            className="flex-1"
          />
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {t.settings.createKey}
          </Button>
        </form>
      )}

      {create.error && <p className="mb-3 text-xs text-level-error">{create.error.message}</p>}

      {/* a warning tone, not an info tone: this is the one screen in the app where walking away
          without reading loses data for good */}
      {createdKey && (
        <div className="mb-3 rounded-lg border border-level-warning/25 bg-level-warning/10 p-3">
          <p className="mb-1 text-xs text-fg">{t.settings.copyTokenNotice}</p>
          <code className="block break-all font-mono text-xs text-fg">{createdKey.token}</code>
          <Button variant="ghost" onClick={() => setCreatedKey(null)} className="mt-2">
            {t.common.dismiss}
          </Button>
        </div>
      )}

      {isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
      {error && <p className="text-sm text-level-error">{error.message}</p>}
      {keys && keys.length === 0 && <p className="text-sm text-fg-muted">{t.settings.noKeys}</p>}

      {keys && keys.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-muted">
              <th className={TH_CLASS}>{t.settings.colTitle}</th>
              <th className={TH_CLASS}>{t.settings.colCreated}</th>
              <th className={TH_CLASS}>{t.settings.colStatus}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-border last:border-b-0">
                <td className={TD_CLASS}>{key.title}</td>
                <td className="py-2 text-xs text-fg-muted">{formatTimestamp(key.createdAt, lang)}</td>
                <td className="py-2">
                  <span className={key.isActive ? 'text-accent' : 'text-fg-muted'}>
                    {key.isActive ? t.settings.active : t.settings.revoked}
                  </span>
                </td>
                <td className="py-2 text-right">
                  {isAdmin && key.isActive && (
                    <Button variant="danger" onClick={() => revoke.mutate(key.id)} disabled={revoke.isPending}>
                      {t.settings.revoke}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface ArchiveFormState {
  compressAfterDays: string
  hydrationKeepDays: string
  retentionDays: string
}

function ArchiveField({
  label,
  hint,
  unit,
  value,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  unit: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-fg">
      <span>
        {label}
        {hint && <span className="ml-1 text-xs text-fg-muted">{hint}</span>}
      </span>
      <span className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="w-24 text-right"
        />
        <span className="text-xs text-fg-muted">{unit}</span>
      </span>
    </label>
  )
}

function ArchiveCard() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  const { data: settings, error } = useQuery({ queryKey: ARCHIVE_SETTINGS_KEY, queryFn: getArchiveSettings })
  const { data: segments } = useQuery({ queryKey: ARCHIVE_SEGMENTS_KEY, queryFn: getArchiveSegments })
  const [form, setForm] = useState<ArchiveFormState | null>(null)

  // the form is editable state seeded from the server value once it arrives
  useEffect(() => {
    if (settings) {
      setForm({
        compressAfterDays: String(settings.compressAfterDays),
        hydrationKeepDays: String(settings.hydrationKeepDays),
        retentionDays: String(settings.retentionDays),
      })
    }
  }, [settings])

  const save = useMutation({
    mutationFn: saveArchiveSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ARCHIVE_SETTINGS_KEY }),
  })

  function handleSave(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    save.mutate({
      compressAfterDays: Number(form.compressAfterDays),
      hydrationKeepDays: Number(form.hydrationKeepDays),
      retentionDays: Number(form.retentionDays),
    })
  }

  const totalSize = (segments ?? []).reduce((sum, segment) => sum + segment.sizeBytes, 0)
  const totalUncompressed = (segments ?? []).reduce((sum, segment) => sum + segment.uncompressedBytes, 0)
  const ratio = totalSize > 0 ? totalUncompressed / totalSize : undefined

  if (error) {
    return <p className="text-sm text-level-error">{error.message}</p>
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSave} className="flex max-w-md flex-col gap-3">
        <ArchiveField
          label={t.settings.compressAfter}
          hint={t.settings.compressHint}
          unit={t.settings.days}
          value={form?.compressAfterDays ?? ''}
          onChange={(value) => setForm((current) => current && { ...current, compressAfterDays: value })}
          disabled={!isAdmin}
        />
        <ArchiveField
          label={t.settings.keepExtracted}
          unit={t.settings.days}
          value={form?.hydrationKeepDays ?? ''}
          onChange={(value) => setForm((current) => current && { ...current, hydrationKeepDays: value })}
          disabled={!isAdmin}
        />
        <ArchiveField
          label={t.settings.deleteArchives}
          unit={t.settings.days}
          value={form?.retentionDays ?? ''}
          onChange={(value) => setForm((current) => current && { ...current, retentionDays: value })}
          disabled={!isAdmin}
        />
        {isAdmin && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!form || save.isPending} className="self-start">
              {t.settings.saveArchive}
            </Button>
            {save.isSuccess && <span className="text-xs text-accent">{t.settings.saved}</span>}
          </div>
        )}
        {save.error && <p className="text-xs text-level-error">{save.error.message}</p>}
      </form>

      <dl className="grid grid-cols-3 gap-4 border-t border-border pt-3 text-sm">
        <div>
          <dt className="text-xs text-fg-muted">{t.settings.archivedDays}</dt>
          <dd className="tabular text-fg">{segments?.length ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t.settings.compressedSize}</dt>
          <dd className="tabular text-fg">{segments ? formatBytes(totalSize) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t.settings.compressionRatio}</dt>
          <dd className="tabular text-fg">{ratio ? `${ratio.toFixed(1)}×` : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

const ROLES: UserRole[] = ['viewer', 'admin']

function UsersCard() {
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
              <th className={TH_CLASS}>{t.settings.colCreated}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-border last:border-b-0">
                <td className={TD_CLASS}>{user.username}</td>
                <td className="py-2 text-fg-muted">{user.role}</td>
                <td className="py-2 text-xs text-fg-muted">{formatTimestamp(user.createdAt, lang)}</td>
                <td className="py-2 text-right">
                  <Button variant="danger" onClick={() => deleteUser.mutate(user.id)} disabled={deleteUser.isPending}>
                    {t.common.delete}
                  </Button>
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

export function SettingsPage() {
  const { t } = useI18n()
  const { data: authStatus } = useAuthStatus()
  const isAdmin = useIsAdmin()
  const logoutMutation = useLogout()

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.settings.title}</h1>
        {authStatus?.authRequired && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              {t.settings.signedInAs(authStatus.username ?? '', authStatus.role)}
            </span>
            <Button variant="secondary" onClick={() => logoutMutation.mutate()}>
              {t.settings.signOut}
            </Button>
          </div>
        )}
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.settings.health}</h2>
        <Card className="p-4">
          <HealthCard />
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.settings.apiKeys}</h2>
        <Card className="p-4">
          <ApiKeysCard />
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.settings.archiving}</h2>
        <Card className="p-4">
          <ArchiveCard />
        </Card>
      </section>

      {isAdmin && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-fg">{t.settings.backup}</h2>
          <Card className="p-4">
            <p className="mb-3 text-sm text-fg-muted">{t.settings.backupHint}</p>
            {/* a plain anchor: the session cookie rides along and the browser handles the download */}
            <a
              href="/api/admin/backup"
              className="inline-block rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-surface-hover"
            >
              {t.settings.downloadBackup}
            </a>
          </Card>
        </section>
      )}

      {isAdmin && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-fg">{t.settings.users}</h2>
          <Card className="p-4">
            <UsersCard />
          </Card>
        </section>
      )}
    </div>
  )
}
