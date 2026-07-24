import { Link } from 'react-router-dom'

interface SectionHeaderProps {
  title: string
  /** Optional deep link to the full page for this section. */
  to?: string
  linkLabel?: string
}

/** A labelled band that groups the cards below it, with an optional "open the full page" link. */
export function SectionHeader({ title, to, linkLabel }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
      <h2 className="text-sm font-semibold tracking-wide text-fg">{title}</h2>
      {to && linkLabel && (
        <Link
          to={to}
          className="rounded-lg border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {linkLabel} ↗
        </Link>
      )}
    </div>
  )
}
