import { useState } from 'react'
import type { ComponentPropsWithoutRef, FormEvent, ReactNode } from 'react'
import { useAuthStatus, useChangePassword, useLogin } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import type { Level, LoginMethod } from '../types'
import { LEVEL_CODE, LEVEL_TEXT } from '../lib/levels'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Card } from './ui/Card'

/** The tabs select a mode for this form, so they have to point at it. */
const LOGIN_FORM_ID = 'login-form'

/** A domain user should not have to re-pick LDAP every morning. */
const METHOD_STORAGE_KEY = 'logharbor-login-method'

function rememberedMethod(): LoginMethod {
  return localStorage.getItem(METHOD_STORAGE_KEY) === 'ldap' ? 'ldap' : 'standard'
}

/** One ordinary minute on a LogHarbor instance, standing in for the product behind the
 *  sign-in card. Machine text, so it is not translated — real log lines are not either. */
const SAMPLE_STREAM: { time: string; level: Level; source: string; message: string }[] = [
  { time: '14:32:07', level: 'Information', source: 'ingest', message: 'Accepted 1,284 events from serilog-http in 42 ms' },
  { time: '14:32:08', level: 'Debug', source: 'otlp', message: '/v1/logs accepted 96 records (protobuf)' },
  { time: '14:32:09', level: 'Information', source: 'tail', message: "3 subscribers on @Level = 'Error'" },
  { time: '14:32:10', level: 'Warning', source: 'ingest', message: 'Rate limit reached for key checkout-prod' },
  { time: '14:32:11', level: 'Error', source: 'api', message: 'Order 41973 failed: PostgresException 23505' },
  { time: '14:32:11', level: 'Information', source: 'archive', message: 'Compressed 2026-07-28 · 214 MB → 18 MB' },
]

function SampleStream() {
  const { t } = useI18n()
  return (
    // the stream stands in for the product, so it gets the product's own reading bed
    <div className="glass mt-8 hidden overflow-hidden rounded-card border border-border bg-surface shadow-card lg:block">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-xs text-fg-subtle">events</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wider text-fg-subtle uppercase">
          {t.login.sampleLabel}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {SAMPLE_STREAM.map((line, index) => (
          <li
            key={`${line.time}-${line.message}`}
            className="animate-line-in flex items-baseline gap-3 px-3 py-1.5 text-xs"
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <span className="tabular shrink-0 text-fg-subtle">{line.time}</span>
            <span className={`shrink-0 font-medium ${LEVEL_TEXT[line.level]}`}>{LEVEL_CODE[line.level]}</span>
            <span className="shrink-0 font-mono text-[0.625rem] text-fg-subtle">{line.source}</span>
            <span className="truncate text-fg-muted">{line.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The page around the form: the product on the left, one card on the right. The canvas already
 *  carries the app's ambient wash; this page turns it up, because it is the only screen with
 *  room to be an impression rather than a readout. */
function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-32 size-[42rem] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--color-glow-a), transparent)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -bottom-40 size-[38rem] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--color-glow-b), transparent)' }}
      />

      <div className="animate-rise relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_20rem] lg:gap-16">
        <section>
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-fg uppercase">
            <span
              className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_1px_var(--color-accent)]"
              aria-hidden="true"
            />
            LogHarbor
            <span className="font-medium text-fg-subtle">· {t.login.tagline}</span>
          </p>
          <h1 className="mt-5 text-3xl leading-tight font-semibold text-balance text-fg sm:text-4xl">
            {t.login.heroTitle}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-fg-muted">{t.login.heroBody}</p>
          <SampleStream />
        </section>

        <Card variant="lifted" className="w-full p-6">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <p className="mt-1 mb-5 text-xs leading-relaxed text-fg-muted">{subtitle}</p>
          {children}
        </Card>
      </div>
    </div>
  )
}

/**
 * Renders the login form when there is no session, then the password form while the account
 * still has its seeded password — the API refuses everything else until that is done.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const { data: status, isLoading } = useAuthStatus()
  const { t } = useI18n()

  if (isLoading) {
    return <p className="p-4 text-sm text-fg-muted">{t.common.loading}</p>
  }
  if (!status) {
    return <>{children}</>
  }
  if (!status.authenticated) {
    return <LoginForm />
  }
  if (status.mustChangePassword) {
    return <PasswordChangeForm />
  }
  return <>{children}</>
}

/** A field label above its input: the card has room for it, and a placeholder that doubles as
 *  the label disappears exactly when the user needs it. */
function Field({ label, ...rest }: { label: string } & ComponentPropsWithoutRef<typeof Input>) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      <Input {...rest} className="w-full" />
    </label>
  )
}

/** Both tabs stay visible before a directory exists, so the LDAP side can say what is missing
 *  rather than leaving an empty slot that teaches nothing. */
function MethodTabs({ method, onChange }: { method: LoginMethod; onChange: (next: LoginMethod) => void }) {
  const { t } = useI18n()
  const tabs: { id: LoginMethod; label: string }[] = [
    { id: 'standard', label: t.login.methodStandard },
    { id: 'ldap', label: t.login.methodLdap },
  ]
  return (
    <div role="tablist" className="mb-4 flex gap-1 rounded-lg border border-border bg-surface-inset p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={method === tab.id}
          aria-controls={LOGIN_FORM_ID}
          onClick={() => onChange(tab.id)}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
            method === tab.id
              ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function LoginForm() {
  const { t } = useI18n()
  const { data: status } = useAuthStatus()
  const loginMutation = useLogin()
  const [method, setMethod] = useState<LoginMethod>(rememberedMethod)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const ldapAvailable = status?.ldapEnabled ?? false
  // a remembered choice must not strand someone on a tab that stopped working
  const active: LoginMethod = method === 'ldap' && !ldapAvailable ? 'standard' : method

  function chooseMethod(next: LoginMethod) {
    setMethod(next)
    setError(null)
    localStorage.setItem(METHOD_STORAGE_KEY, next)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await loginMutation.mutateAsync({ username, password, method: active })
      setUsername('')
      setPassword('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t.login.loginFailed)
    }
  }

  const unconfigured = method === 'ldap' && !ldapAvailable

  return (
    <Shell title={t.login.signIn} subtitle={t.login.cardSubtitle}>
      <MethodTabs method={method} onChange={chooseMethod} />
      <form id={LOGIN_FORM_ID} role="tabpanel" onSubmit={handleSubmit}>
        <Field
          label={active === 'ldap' ? t.login.directoryUsername : t.login.username}
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          autoComplete="username"
          disabled={unconfigured}
        />
        <Field
          label={t.login.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          disabled={unconfigured}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={unconfigured || loginMutation.isPending}
          className="mt-1 w-full py-2"
        >
          {loginMutation.isPending ? t.login.signingIn : `${t.login.signIn} →`}
        </Button>
        {unconfigured && (
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t.login.ldapNotConfigured}</p>
        )}
        {!unconfigured && active === 'ldap' && (
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t.login.ldapHint}</p>
        )}
        {error && <p className="mt-3 text-xs text-level-error">{error}</p>}
      </form>
    </Shell>
  )
}

function PasswordChangeForm() {
  const { t } = useI18n()
  const changeMutation = useChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError(t.login.passwordMismatch)
      return
    }
    try {
      await changeMutation.mutateAsync({ currentPassword, newPassword })
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : t.login.passwordChangeFailed)
    }
  }

  return (
    <Shell title={t.login.setPassword} subtitle={t.login.defaultPasswordNotice}>
      <form onSubmit={handleSubmit}>
        <Field
          label={t.login.currentPassword}
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        <Field
          label={t.login.newPassword}
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
        />
        <Field
          label={t.login.confirmNewPassword}
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" variant="primary" disabled={changeMutation.isPending} className="mt-1 w-full py-2">
          {changeMutation.isPending ? t.login.saving : t.login.setPassword}
        </Button>
        {error && <p className="mt-3 text-xs text-level-error">{error}</p>}
      </form>
    </Shell>
  )
}
