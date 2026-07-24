import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { useI18n } from '../../i18n'

interface PulsePanelProps {
  title: string
  /** Route the "view all" header link opens (the full table for this panel). */
  to: string
  isEmpty: boolean
  emptyText: ReactNode
  children: ReactNode
}

/** A compact top-N card for the dashboard: titled header with a deep link, then a row list. */
export function PulsePanel({ title, to, isEmpty, emptyText, children }: PulsePanelProps) {
  const { t } = useI18n()
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <Link to={to} className="shrink-0 text-xs text-fg-muted transition-colors hover:text-accent">
          {t.dashboard.viewAll} →
        </Link>
      </div>
      {isEmpty ? (
        <p className="px-4 py-6 text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
    </Card>
  )
}

interface PulseRowProps {
  onClick?: () => void
  left: ReactNode
  right: ReactNode
}

/** One list row: a truncating label on the left, a fixed metric on the right. */
export function PulseRow({ onClick, left, right }: PulseRowProps) {
  const body = (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">{left}</div>
      <div className="tabular shrink-0 text-sm">{right}</div>
    </div>
  )
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="block w-full text-left transition-colors duration-150 hover:bg-surface-hover"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  )
}
