import { PillLink } from '../ui/PillLink'

interface SectionHeaderProps {
  title: string
  /** Optional deep link to the full page for this section. */
  to?: string
  linkLabel?: string
}

/** A labelled band that groups the cards below it, with an optional "open the full page" link.
 *  Deliberately quieter than a panel title: this names a region of the page, and the cards
 *  under it carry the emphasis. */
export function SectionHeader({ title, to, linkLabel }: SectionHeaderProps) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h2 className="text-[0.625rem] font-semibold tracking-[0.14em] text-fg-subtle uppercase">{title}</h2>
      {to && linkLabel && <PillLink to={to}>{linkLabel}</PillLink>}
    </div>
  )
}
