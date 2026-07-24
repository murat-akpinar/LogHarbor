import { NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { useI18n } from '../i18n'
import { PageIcon } from './icons'
import type { PageIconName } from './icons'
import { Button } from './ui/Button'

interface NavBarProps {
  theme: Theme
  onToggleTheme: () => void
}

export function NavBar({ theme, onToggleTheme }: NavBarProps) {
  const { t, lang, setLang } = useI18n()

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
      <span className="mr-6 flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
        LogHarbor
      </span>
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
      <Button
        variant="ghost"
        onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
        aria-label={t.nav.switchLanguage}
        title={t.nav.switchLanguage}
        className="ml-auto"
      >
        {lang.toUpperCase()}
      </Button>
      <Button
        variant="ghost"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
        title={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </Button>
    </nav>
  )
}
