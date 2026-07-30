import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLdapSettings, saveLdapSettings, testLdap } from '../../api/settings'
import { useI18n } from '../../i18n'
import { useIsAdmin } from '../../hooks/useAuth'
import type { LdapSettings } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

const LDAP_SETTINGS_KEY = ['settings', 'ldap']

/** Ports that go with each choice, so switching the mode does not leave the wrong one behind. */
const DEFAULT_PORT: Record<LdapSettings['security'], number> = {
  ldaps: 636,
  starttls: 389,
  none: 389,
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  placeholder,
  type = 'text',
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">
        {label}
        {hint && <span className="ml-1 font-normal text-fg-subtle">{hint}</span>}
      </span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full"
      />
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled: boolean
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 accent-accent"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * Directory sign-in configuration, and the button that says whether it works.
 *
 * The test button is the point of the card. A wrong base DN, a group spelled differently in this
 * domain, a certificate nobody trusts — none of it shows up until somebody tries to sign in, and
 * then it is a 401 with no reason attached. This asks the directory the same question the login
 * page will, and reports the groups it actually returned.
 */
export function LdapCard() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  const { data: settings, error } = useQuery({ queryKey: LDAP_SETTINGS_KEY, queryFn: getLdapSettings })
  const [form, setForm] = useState<LdapSettings | null>(null)
  const [probeUser, setProbeUser] = useState('')
  const [probePassword, setProbePassword] = useState('')

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const save = useMutation({
    mutationFn: saveLdapSettings,
    // enabling it turns authentication on for the whole server, which auth status reports
    onSuccess: () => queryClient.invalidateQueries(),
  })

  const probe = useMutation({
    mutationFn: () => testLdap(probeUser, probePassword, form!),
  })

  function set<K extends keyof LdapSettings>(key: K, value: LdapSettings[K]) {
    setForm((current) => current && { ...current, [key]: value })
  }

  function handleSave(event: FormEvent) {
    event.preventDefault()
    if (form) save.mutate(form)
  }

  if (error) {
    return <p className="text-sm text-level-error">{error.message}</p>
  }
  if (!form) {
    return <p className="text-sm text-fg-muted">{t.common.loading}</p>
  }

  const locked = !isAdmin
  const insecure = form.security === 'none'

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <Toggle
          label={t.settings.ldapEnable}
          hint={t.settings.ldapEnableHint}
          checked={form.enabled}
          onChange={(value) => set('enabled', value)}
          disabled={locked}
        />

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field
            label={t.settings.ldapHost}
            value={form.host}
            onChange={(value) => set('host', value)}
            disabled={locked}
            placeholder="dc01.corp.example"
          />
          <Field
            label={t.settings.ldapPort}
            type="number"
            value={String(form.port)}
            onChange={(value) => set('port', Number(value))}
            disabled={locked}
          />
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t.settings.ldapSecurity}</span>
          <select
            value={form.security}
            disabled={locked}
            onChange={(event) => {
              const security = event.target.value as LdapSettings['security']
              setForm((current) => current && { ...current, security, port: DEFAULT_PORT[security] })
            }}
            className="w-full rounded-md border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg"
          >
            <option value="ldaps">{t.settings.ldapSecurityLdaps}</option>
            <option value="starttls">{t.settings.ldapSecurityStartTls}</option>
            <option value="none">{t.settings.ldapSecurityNone}</option>
          </select>
        </label>
        {insecure && <p className="text-xs text-level-warning">{t.settings.ldapInsecureWarning}</p>}

        <Field
          label={t.settings.ldapBaseDn}
          value={form.baseDn}
          onChange={(value) => set('baseDn', value)}
          disabled={locked}
          placeholder="dc=corp,dc=example"
        />
        <Field
          label={t.settings.ldapUpnSuffix}
          hint={t.settings.ldapUpnSuffixHint}
          value={form.upnSuffix}
          onChange={(value) => set('upnSuffix', value)}
          disabled={locked}
          placeholder="corp.example"
        />
        <Field
          label={t.settings.ldapUserDnPattern}
          hint={t.settings.ldapUserDnPatternHint}
          value={form.userDnPattern}
          onChange={(value) => set('userDnPattern', value)}
          disabled={locked}
          placeholder="uid={0},ou=users,dc=corp,dc=example"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t.settings.ldapAdminGroup}
            value={form.adminGroup}
            onChange={(value) => set('adminGroup', value)}
            disabled={locked}
          />
          <Field
            label={t.settings.ldapViewerGroup}
            value={form.viewerGroup}
            onChange={(value) => set('viewerGroup', value)}
            disabled={locked}
          />
        </div>

        <Toggle
          label={t.settings.ldapNestedGroups}
          hint={t.settings.ldapNestedGroupsHint}
          checked={form.nestedGroups}
          onChange={(value) => set('nestedGroups', value)}
          disabled={locked}
        />
        <Toggle
          label={t.settings.ldapAllowInvalidCertificate}
          hint={t.settings.ldapAllowInvalidCertificateHint}
          checked={form.allowInvalidCertificate}
          onChange={(value) => set('allowInvalidCertificate', value)}
          disabled={locked || insecure}
        />

        <p className="text-xs text-fg-muted">
          {form.enabled
            ? t.settings.ldapSummary(form.host, form.port, form.adminGroup, form.viewerGroup)
            : t.settings.ldapSummaryDisabled}
        </p>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={save.isPending} className="self-start">
              {t.settings.ldapSave}
            </Button>
            {save.isSuccess && <span className="text-xs text-accent">{t.settings.saved}</span>}
          </div>
        )}
        {save.error && <p className="text-xs text-level-error">{save.error.message}</p>}
      </form>

      {isAdmin && (
        <div className="border-t border-border pt-3">
          <p className="text-sm font-medium text-fg">{t.settings.ldapTestTitle}</p>
          <p className="mt-1 mb-3 text-xs text-fg-muted">{t.settings.ldapTestHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t.settings.ldapTestUsername}
              value={probeUser}
              onChange={setProbeUser}
              disabled={false}
            />
            <Field
              label={t.settings.ldapTestPassword}
              type="password"
              value={probePassword}
              onChange={setProbePassword}
              disabled={false}
            />
          </div>
          <Button
            type="button"
            onClick={() => probe.mutate()}
            disabled={probe.isPending || probeUser.length === 0 || probePassword.length === 0}
            className="mt-3 self-start"
          >
            {probe.isPending ? t.settings.ldapTesting : t.settings.ldapTest}
          </Button>

          {probe.error && <p className="mt-3 text-xs text-level-error">{probe.error.message}</p>}
          {probe.data && (
            <div className="mt-3 rounded-lg border border-border bg-surface-inset p-3 text-xs">
              <p className={probe.data.succeeded ? 'text-accent' : 'text-level-warning'}>
                {probe.data.succeeded
                  ? t.settings.ldapTestOk(probe.data.role ?? '')
                  : probe.data.bound
                    ? t.settings.ldapTestNoRole
                    : t.settings.ldapTestFailed}
              </p>
              {probe.data.groups.length > 0 && (
                <ul className="mt-2 space-y-0.5 font-mono text-fg-muted">
                  {probe.data.groups.map((group) => (
                    <li key={group} className="truncate">
                      {group}
                    </li>
                  ))}
                </ul>
              )}
              {probe.data.detail && <p className="mt-2 text-fg-subtle">{probe.data.detail}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
