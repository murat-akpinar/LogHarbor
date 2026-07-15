import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuthStatus, useChangePassword, useLogin } from '../hooks/useAuth'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Card } from './ui/Card'

function Shell({ children }: { children: ReactNode }) {
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
        <p className="mb-5 text-xs text-fg-muted">Structured log server</p>
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

  if (isLoading) {
    return <p className="p-4 text-sm text-fg-muted">Loading…</p>
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
      setError(loginError instanceof Error ? loginError.message : 'Login failed.')
    }
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit}>
        <Input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoFocus
          autoComplete="username"
          className="mb-2 w-full"
        />
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="mb-2 w-full"
        />
        <Button type="submit" variant="primary" disabled={loginMutation.isPending} className="mt-1 w-full">
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        {error && <p className="mt-3 text-xs text-level-error">{error}</p>}
      </form>
    </Shell>
  )
}

function PasswordChangeForm() {
  const changeMutation = useChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.')
      return
    }
    try {
      await changeMutation.mutateAsync({ currentPassword, newPassword })
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Could not change the password.')
    }
  }

  return (
    <Shell>
      <p className="mb-3 text-xs text-fg-muted">
        This account still has its default password. Pick a new one (at least 8 characters) to
        continue.
      </p>
      <form onSubmit={handleSubmit}>
        <Input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder="Current password"
          autoFocus
          autoComplete="current-password"
          className="mb-2 w-full"
        />
        <Input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          className="mb-2 w-full"
        />
        <Input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className="mb-2 w-full"
        />
        <Button type="submit" variant="primary" disabled={changeMutation.isPending} className="mt-1 w-full">
          {changeMutation.isPending ? 'Saving…' : 'Set password'}
        </Button>
        {error && <p className="mt-3 text-xs text-level-error">{error}</p>}
      </form>
    </Shell>
  )
}
