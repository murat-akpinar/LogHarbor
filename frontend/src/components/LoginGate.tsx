import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuthStatus, useChangePassword, useLogin } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Card } from './ui/Card'

function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="relative flex h-screen items-center justify-center bg-bg">
      {/* a faint accent wash behind the card: the only decorative flourish in the app */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--color-accent),transparent_70%)] opacity-[0.07]"
      />
      <Card className="relative w-80 p-6">
        <h1 className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          LogHarbor
        </h1>
        <p className="mb-5 text-xs text-fg-muted">{t.login.tagline}</p>
        {children}
      </Card>
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

function LoginForm() {
  const { t } = useI18n()
  const loginMutation = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await loginMutation.mutateAsync({ username, password })
      setUsername('')
      setPassword('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t.login.loginFailed)
    }
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit}>
        <Input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t.login.username}
          autoFocus
          autoComplete="username"
          className="mb-2 w-full"
        />
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t.login.password}
          autoComplete="current-password"
          className="mb-2 w-full"
        />
        <Button type="submit" variant="primary" disabled={loginMutation.isPending} className="mt-1 w-full">
          {loginMutation.isPending ? t.login.signingIn : t.login.signIn}
        </Button>
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
    <Shell>
      <p className="mb-3 text-xs text-fg-muted">{t.login.defaultPasswordNotice}</p>
      <form onSubmit={handleSubmit}>
        <Input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder={t.login.currentPassword}
          autoFocus
          autoComplete="current-password"
          className="mb-2 w-full"
        />
        <Input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder={t.login.newPassword}
          autoComplete="new-password"
          className="mb-2 w-full"
        />
        <Input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder={t.login.confirmNewPassword}
          autoComplete="new-password"
          className="mb-2 w-full"
        />
        <Button type="submit" variant="primary" disabled={changeMutation.isPending} className="mt-1 w-full">
          {changeMutation.isPending ? t.login.saving : t.login.setPassword}
        </Button>
        {error && <p className="mt-3 text-xs text-level-error">{error}</p>}
      </form>
    </Shell>
  )
}
