import { PillLink } from '../ui/PillLink'
import { PageIcon } from '../icons'
import type { PageIconName } from '../icons'

interface SectionHeaderProps {
  title: string
  /** Small plate left of the title, naming the kind of thing the section groups. */
  icon?: PageIconName
  /** A count or other one-word fact about the section, set beside the title. */
  meta?: string
  /** Optional deep link to the full page for this section. */
  to?: string
  linkLabel?: string
}

/** A labelled band that groups the cards below it, with an optional "open the full page" link.
 *  Deliberately quieter than a panel title: this names a region of the page, and the cards
 *  under it carry the emphasis. */
export function SectionHeader({ title, icon, meta, to, linkLabel }: SectionHeaderProps) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
        {icon && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised text-fg-muted"
            aria-hidden="true"
          >
            <PageIcon name={icon} className="size-3.5" />
          </span>
        )}
        <span className="truncate">{title}</span>
        {meta && <span className="tabular shrink-0 text-xs font-normal text-fg-subtle">{meta}</span>}
      </h2>
      {to && linkLabel && <PillLink to={to}>{linkLabel}</PillLink>}
    </div>
  )
}
