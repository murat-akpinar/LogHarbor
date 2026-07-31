import type { ReactNode } from 'react'
import { PageIcon } from '../icons'
import type { PageIconName } from '../icons'
import { PillLink } from './PillLink'

/**
 * One region of the page as a single object: a plate, its name, one way out of it, and the
 * wells that hold the content. A page that holds one thing takes the plate without a header —
 * repeating the page's own title over its only table names nothing.
 *
 * The frame belongs here and nowhere inside. A page of individually framed panels reads as a
 * pile of boxes with nothing saying which belong together; a page of three named sections reads
 * as three answers. The action is the link to the page that holds the whole of what the section
 * samples, so a section can stay a summary instead of growing until it duplicates a page.
 */
export function SectionBlock({
  icon,
  title,
  meta,
  to,
  linkLabel,
  children,
  className = '',
}: {
  icon?: PageIconName
  /** Omitted leaves the plate headerless, for a page whose h1 already names the one thing on it. */
  title?: string
  /** A count or other one-word fact about the section, set beside the title. */
  meta?: string
  to?: string
  linkLabel?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-section border border-border bg-surface p-3 shadow-card ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-3 px-2 pt-1">
          <h2 className="flex min-w-0 items-center gap-2.5 text-base font-medium text-fg">
            {icon && (
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-fg-muted"
                aria-hidden="true"
              >
                <PageIcon name={icon} className="size-4" />
              </span>
            )}
            <span className="truncate">{title}</span>
            {meta && <span className="tabular shrink-0 text-xs font-normal text-fg-subtle">{meta}</span>}
          </h2>
          {to && linkLabel && <PillLink to={to}>{linkLabel}</PillLink>}
        </div>
      )}
      {children}
    </section>
  )
}
