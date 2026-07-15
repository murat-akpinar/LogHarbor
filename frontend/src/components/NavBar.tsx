import { NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { Button } from './ui/Button'

const LINKS = [
  { to: '/', label: 'Events', end: true },
  { to: '/dashboard', label: 'Dashboard', end: false },
  { to: '/analysis', label: 'Analysis', end: false },
  { to: '/signals', label: 'Signals', end: false },
  { to: '/alerts', label: 'Alerts', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

interface NavBarProps {
  theme: Theme
  onToggleTheme: () => void
}

export function NavBar({ theme, onToggleTheme }: NavBarProps) {
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
      <span className="mr-6 flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
        LogHarbor
      </span>
      {LINKS.map(({ to, label, end }) => (
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
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="ml-auto"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </Button>
    </nav>
  )
}
