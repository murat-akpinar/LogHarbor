import { NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

interface NavBarProps {
  theme: Theme
  onToggleTheme: () => void
}

export function NavBar({ theme, onToggleTheme }: NavBarProps) {
  const { t, lang, setLang } = useI18n()

  const links = [
    { to: '/', label: t.nav.events, end: true },
    { to: '/dashboard', label: t.nav.dashboard, end: false },
    { to: '/analysis', label: t.nav.analysis, end: false },
    { to: '/signals', label: t.nav.signals, end: false },
    { to: '/alerts', label: t.nav.alerts, end: false },
    { to: '/settings', label: t.nav.settings, end: false },
  ]

  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
      <span className="mr-6 flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
        LogHarbor
      </span>
      {links.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'bg-surface-raised text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            }`
          }
        >
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
