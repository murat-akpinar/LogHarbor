import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Card } from './Card'

/** Gap between the trigger and the panel, and the margin the panel keeps off the viewport edge. */
const GAP = 8

/**
 * The shape an explanation of a computed figure takes: what it measures first, then the things
 * the number alone does not say — how this particular reading was assembled, and what it hides.
 *
 * Ordered and weighted on purpose. Somebody who opens this wants the definition; the caveat is
 * what they come back for, and burying it in one paragraph with the definition means neither
 * gets read.
 */
export function HelpLines({ lines }: { lines: (string | false | null | undefined)[] }) {
  const real = lines.filter((line): line is string => typeof line === 'string' && line.length > 0)
  return (
    <>
      {real.map((line, index) => (
        <p key={line} className={index === 0 ? 'text-fg' : 'mt-1.5 text-fg-subtle'}>
          {line}
        </p>
      ))}
    </>
  )
}

interface Position {
  left: number
  top: number
  placement: 'above' | 'below'
}

/**
 * A hover/focus/tap readout that can hold a sentence.
 *
 * Why not `title=`: it waits about a second, renders one line in the browser's own chrome, cannot
 * be styled to match anything, and on a touch device it does not exist at all. That is fine for
 * revealing text a cell truncated — the string is already on screen, just clipped — and useless
 * for the thing this exists to do, which is explain a computed number.
 *
 * Two mechanics are not decoration:
 *
 *  * It renders through a portal at fixed coordinates. Every table in this product sits inside an
 *    `overflow-x-auto` panel, and an absolutely positioned panel inside one of those is clipped by
 *    it — the explanation on a column header would be cut in half by the container it explains.
 *  * It opens on focus, not only on hover, and closes on Escape. A keyboard reader gets the same
 *    explanation, which is the whole point of writing one.
 *
 * The bed is Card's `float`: nearly opaque, because a readout you can see the chart through is one
 * you have to squint at.
 */
export function Tooltip({
  content,
  children,
  className = '',
}: {
  /** Lines, elements, whatever — it is a panel, not a string. */
  content: ReactNode
  /** The trigger. Must be focusable for the keyboard path to work. */
  children: ReactNode
  className?: string
}) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)

  const place = useCallback(() => {
    const trigger = anchor.current?.getBoundingClientRect()
    const box = panel.current?.getBoundingClientRect()
    if (!trigger || !box) return

    // above by default; below only when the top would leave the viewport, which is what happens
    // to a tooltip on the first row of a table near the top of the page
    const above = trigger.top - box.height - GAP >= GAP
    const left = Math.min(
      Math.max(GAP, trigger.left + trigger.width / 2 - box.width / 2),
      window.innerWidth - box.width - GAP,
    )
    setPosition({
      left,
      top: above ? trigger.top - box.height - GAP : trigger.bottom + GAP,
      placement: above ? 'above' : 'below',
    })
  }, [])

  // measured after the panel exists but before the browser paints it, so it never appears at 0,0
  // and jumps into place
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    // a page that scrolls under an open panel would leave it pointing at nothing
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <span
      ref={anchor}
      className={`inline-flex ${className}`}
      // pointerenter fires on a tap too, so the mouse path is gated on the pointer being one
      onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((was) => !was)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-72"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              // hidden until measured rather than rendered off-screen: one frame at the wrong
              // place reads as a flicker
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            <Card variant="float" className="animate-rise px-3 py-2 text-xs leading-relaxed text-fg-muted">
              {content}
            </Card>
          </div>,
          document.body,
        )}
    </span>
  )
}
