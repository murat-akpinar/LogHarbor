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
        <Link to={to} className="text-xs text-fg-muted transition-colors hover:text-accent">
          {linkLabel} ↗
        </Link>
      )}
    </div>
  )
}
