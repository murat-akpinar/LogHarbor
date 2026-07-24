import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

interface SidebarProps {
  theme: Theme
  onToggleTheme: () => void
}

interface NavItem {
  to: string
  label: string
  end?: boolean
}

interface NavGroup {
  /** null renders the items without a group caption (the Overview row). */
  header: string | null
  items: NavItem[]
}

const LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2 py-1.5 text-sm font-medium transition-colors duration-150 ${
    isActive ? 'bg-surface-raised text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
  }`

/** Nightwatch-style grouped left nav; on small screens a top bar with a hamburger drawer. */
export function Sidebar({ theme, onToggleTheme }: SidebarProps) {
  const { t, lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)

  const groups: NavGroup[] = [
    { header: null, items: [{ to: '/', label: t.nav.overview, end: true }] },
    {
      header: t.nav.groupActivity,
      items: [
        { to: '/events', label: t.nav.events },
        { to: '/requests', label: t.nav.requests },
      ],
    },
    {
      header: t.nav.groupAnalysis,
      items: [
        { to: '/analysis', label: t.nav.analysis },
        { to: '/services', label: t.nav.services },
        { to: '/users', label: t.nav.users },
      ],
    },
    {
      header: t.nav.groupSystem,
      items: [
        { to: '/signals', label: t.nav.signals },
        { to: '/alerts', label: t.nav.alerts },
        { to: '/settings', label: t.nav.settings },
      ],
    },
  ]

  const content = (
    <>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-semibold text-fg">
        <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
        LogHarbor
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2">
        {groups.map((group) => (
          <div key={group.header ?? 'top'} className="flex flex-col gap-0.5">
            {group.header && (
              <p className="mt-4 mb-1 px-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                {group.header}
              </p>
            )}
            {group.items.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={LINK_CLASS}>
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1 border-t border-border p-2">
        <Button
          variant="ghost"
          onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
          aria-label={t.nav.switchLanguage}
          title={t.nav.switchLanguage}
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
      </div>
    </>
  )

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
        <Button variant="ghost" onClick={() => setOpen(true)} aria-label={t.nav.openMenu} title={t.nav.openMenu}>
          ☰
        </Button>
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          LogHarbor
        </span>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-56 flex-col border-r border-border bg-surface">
            {content}
          </aside>
        </div>
      )}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">{content}</aside>
    </>
  )
}
