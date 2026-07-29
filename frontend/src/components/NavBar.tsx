import { Link, NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { useAuthStatus, useLogout } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { PageIcon } from './icons'
import type { PageIconName } from './icons'
import { Button } from './ui/Button'

/** Door with an arrow leaving it. Not in icons.tsx: that set names pages, and this is an action. */
function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5M5 12h9" />
    </svg>
  )
}

interface NavBarProps {
  theme: Theme
  onToggleTheme: () => void
}

export function NavBar({ theme, onToggleTheme }: NavBarProps) {
  const { t, lang, setLang } = useI18n()
  const { data: authStatus } = useAuthStatus()
  const logoutMutation = useLogout()

  const links: { to: string; label: string; end: boolean; icon: PageIconName }[] = [
    { to: '/', label: t.nav.dashboard, end: true, icon: 'dashboard' },
    { to: '/events', label: t.nav.events, end: false, icon: 'events' },
    { to: '/requests', label: t.nav.requests, end: false, icon: 'requests' },
    { to: '/exceptions', label: t.nav.exceptions, end: false, icon: 'exceptions' },
    { to: '/queries', label: t.nav.queries, end: false, icon: 'queries' },
    { to: '/services', label: t.nav.services, end: false, icon: 'services' },
    { to: '/users', label: t.nav.users, end: false, icon: 'users' },
    { to: '/analysis', label: t.nav.analysis, end: false, icon: 'analysis' },
    { to: '/signals', label: t.nav.signals, end: false, icon: 'signals' },
    { to: '/alerts', label: t.nav.alerts, end: false, icon: 'alerts' },
    { to: '/settings', label: t.nav.settings, end: false, icon: 'settings' },
  ]

  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
      <Link
        to="/"
        className="mr-6 flex items-center gap-2 rounded-lg text-sm font-semibold text-fg transition-colors duration-150 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <span
          className="flex size-6 items-center justify-center rounded-md border border-border bg-surface-raised"
          aria-hidden="true"
        >
          <span className="size-1.5 rounded-full bg-accent" />
        </span>
        LogHarbor
      </Link>
      {links.map(({ to, label, end, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'bg-surface-raised text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            }`
          }
        >
          <PageIcon name={icon} />
          {label}
        </NavLink>
      ))}
      {/* the two instance-wide switches, grouped as one control so they read apart from the pages */}
      <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
        <Button
          variant="ghost"
          onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
          aria-label={t.nav.switchLanguage}
          title={t.nav.switchLanguage}
          className="px-2 py-1 text-xs font-semibold tracking-wide"
        >
          {lang.toUpperCase()}
        </Button>
        <Button
          variant="ghost"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
          title={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
          className="px-2 py-1"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </Button>
        {/* only when there is a session to end: an install with no accounts has nothing to sign
            out of. The tooltip carries who is signed in, which is the other half of Settings' row */}
        {authStatus?.authRequired && (
          <Button
            variant="ghost"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            aria-label={t.settings.signOut}
            title={t.settings.signedInAs(authStatus.username ?? '', authStatus.role ?? '')}
            className="px-2 py-1"
          >
            <SignOutIcon />
          </Button>
        )}
      </div>
    </nav>
  )
}
