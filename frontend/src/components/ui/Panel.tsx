import type { CSSProperties, ReactNode } from 'react'

/**
 * A well sunk into a section: darker than the plate around it, carrying no frame of its own.
 *
 * This is what a card becomes once it lives inside a SectionBlock. Two nested frames read as
 * two boxes and the eye stops at the outer one, so the inner object is drawn as a change of
 * depth instead — the section holds the border, the wells hold the content. On glass that
 * works out as black at low alpha: the plate lifts off the canvas, the well cuts into it.
 */
export function Panel({
  children,
  className = '',
  /** Lifts on hover, for a well that is also a link or a button. */
  interactive = false,
  style,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
  /** Carries the entrance delay a caller staggers a row of wells with. */
  style?: CSSProperties
}) {
  return (
    <div
      style={style}
      className={`rounded-well bg-surface-inset ring-1 ring-white/[0.04] ${
        interactive ? 'transition-colors duration-200 hover:bg-surface-hover hover:ring-white/10' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}
