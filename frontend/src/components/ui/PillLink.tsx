import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** The bordered "open the full page" chip that sits at the right end of a section or
 *  panel header. Uppercase and quiet on purpose: it labels an exit, it is not an action. */
export function PillLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="shrink-0 rounded-md border border-border bg-surface-inset px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wider text-fg-subtle uppercase transition-all duration-200 hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
    >
      {children} ↗
    </Link>
  )
}
