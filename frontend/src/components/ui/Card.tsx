import type { ReactNode } from 'react'

/**
 * A free-standing object on the canvas: translucent, blurred, edged with a hairline.
 *
 * The blur is what makes it read as glass rather than as grey — it has the lit canvas and the
 * grain behind it, and a card that only changed colour would look painted on. Anything that
 * floats over the page (tooltips, popovers) takes `pop` for a heavier shadow, because a thing
 * that hovers has to separate from the thing it hovers over.
 */
export function Card({
  children,
  className = '',
  pop = false,
}: {
  children: ReactNode
  className?: string
  pop?: boolean
}) {
  return (
    <div
      className={`glass rounded-card border border-border bg-surface ${pop ? 'shadow-pop' : 'shadow-card'} ${className}`}
    >
      {children}
    </div>
  )
}
