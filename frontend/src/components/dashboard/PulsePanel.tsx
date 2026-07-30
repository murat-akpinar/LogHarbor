import type { ReactNode } from 'react'
import { Panel } from '../ui/Panel'
import { PillLink } from '../ui/PillLink'
import { useI18n } from '../../i18n'

interface PulsePanelProps {
  title: string
  /** Route the "view all" header link opens (the full table for this panel). */
  to: string
  isEmpty: boolean
  emptyText: ReactNode
  /** What the rows add up to, said as a sentence. Set large: it is the answer, and the rows
   *  under it are the evidence. */
  lead?: ReactNode
  /** Rows as separate plates instead of a divided list, for rows that carry two lines each. */
  cards?: boolean
  children: ReactNode
}

/** A top-N well for the dashboard: an eyebrow with a deep link, an optional lead, then rows. */
export function PulsePanel({ title, to, isEmpty, emptyText, lead, cards = false, children }: PulsePanelProps) {
  const { t } = useI18n()
  return (
    <Panel className="flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="truncate text-xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">{title}</h3>
        <PillLink to={to}>{t.dashboard.viewAll}</PillLink>
      </div>
      {isEmpty ? (
        <p className="py-6 text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <>
          {lead && <p className="mb-4 text-lg leading-snug font-semibold text-balance text-fg">{lead}</p>}
          <ul className={cards ? 'space-y-1.5' : '-mx-2 divide-y divide-border/60'}>{children}</ul>
        </>
      )}
    </Panel>
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
    <div className="flex items-center justify-between gap-3 px-2 py-2">
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
          className="block w-full rounded-lg text-left transition-colors duration-150 hover:bg-surface-hover"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  )
}
