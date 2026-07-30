import type { ReactNode } from 'react'

/**
 * A well sunk into a section: darker than the section on dark, lighter on light, and carrying
 * no frame of its own.
 *
 * This is what a card becomes once it lives inside a SectionBlock. Two nested frames read as
 * two boxes and the eye stops at the outer one, so the inner object is drawn as a change of
 * surface instead — the section holds the border, the wells hold the content.
 */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-well bg-surface-inset ${className}`}>{children}</div>
}
