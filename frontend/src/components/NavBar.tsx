import { Link, NavLink } from 'react-router-dom'
import { useAuthStatus, useLogout } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { PageIcon } from './icons'
import type { PageIconName } from './icons'
import { Button } from './ui/Button'

/** An arrow dropping into a tray: data arriving. Not in icons.tsx — that set names pages. */
function SendIcon() {
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
      <path d="M12 3v10m0 0l4-4m-4 4l-4-4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

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

export function NavBar() {
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
    <nav className="glass relative flex h-13 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      {/* a hairline of accent light along the bottom edge, brightest under the brand: the bar is
          translucent, so it needs an edge that is drawn rather than merely a colour change */}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-accent/50 via-accent/10 to-transparent"
        aria-hidden="true"
      />
      <Link
        to="/"
        className="group mr-5 flex shrink-0 items-center gap-2.5 rounded-lg text-sm font-semibold text-fg transition-colors duration-150 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <span
          className="flex size-7 items-center justify-center rounded-lg bg-accent/15 ring-1 ring-accent/25 transition-shadow duration-200 group-hover:shadow-[0_0_16px_-2px_var(--color-accent)]"
          aria-hidden="true"
        >
          <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_1px_var(--color-accent)]" />
        </span>
        LogHarbor
      </Link>

      {/* Eleven links do not fit a narrow window, so this lane scrolls rather than pushing the
          page sideways. Only the page tabs are in it: everything to its right has to stay
          reachable at every width, which is exactly what went wrong the first time. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {links.map(({ to, label, end, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
              isActive
                ? 'bg-surface-raised text-fg shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07)]'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <PageIcon name={icon} />
              {label}
              {/* the active page is underscored in accent, so which page you are on survives
                  being read at a glance across eleven near-identical pills */}
              {isActive && (
                <span
                  className="absolute inset-x-3 -bottom-px h-px rounded-full bg-accent shadow-[0_0_8px_0_var(--color-accent)]"
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </NavLink>
      ))}
      </div>

      {/* Getting data in is not a lens, so it is not a page tab — but it is the first thing a
          new install needs and it was unfindable when it lived only under Settings (reported
          2026-07-31: "info sayfası ekleyip deploy ettin mi göremedim arayüzde"). Pinned here,
          outside the scrolling lane, so it is on screen at every width. */}
      <NavLink
        to="/send"
        className={({ isActive }) =>
          `flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-all duration-200 ${
            isActive
              ? 'border-accent/50 bg-accent/15 text-accent'
              : 'border-border bg-surface-inset text-fg-muted hover:border-accent/40 hover:bg-accent/10 hover:text-accent'
          }`
        }
      >
        <SendIcon />
        <span className="hidden sm:inline">{t.nav.send}</span>
      </NavLink>

      {/* the instance-wide switches, grouped as one control so they read apart from the pages */}
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-inset p-0.5">
        <Button
          variant="ghost"
          onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
          aria-label={t.nav.switchLanguage}
          title={t.nav.switchLanguage}
          className="px-2 py-1 text-xs font-semibold tracking-wide"
        >
          {lang.toUpperCase()}
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
