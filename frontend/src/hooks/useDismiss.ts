import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Closes an open popover when the pointer goes down anywhere outside it, or on Escape.
 *
 * pointerdown rather than click: by the time a click completes the user has already moved on,
 * and a menu that is still open under their cursor swallows the thing they were reaching for.
 *
 * The ref has to wrap the trigger as well as the panel. With the trigger outside it, its own
 * press dismisses first and the click then reopens what the user meant to close.
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismiss()
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onDismiss()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, ref, onDismiss])
}
