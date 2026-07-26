import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

/** Breathing room kept between the panel and the window edge. */
const VIEWPORT_MARGIN = 8

interface ColumnPickerProps {
  columns: string[]
  onChange: (columns: string[]) => void
}

/** Pick event properties to show as extra list columns. */
export function ColumnPicker({ columns, onChange }: ColumnPickerProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [alignLeft, setAlignLeft] = useState(false)

  // This button lives in a wrapping toolbar, so unlike the other dropdowns it is not pinned
  // to a window edge: when the row wraps it slides left, and a right-aligned panel then hangs
  // off the left of the window with the input at the bottom of it out of reach. Measured when
  // the panel opens rather than guessed from a breakpoint, because what decides it is where
  // the button ended up after wrapping, not how wide the window is.
  useLayoutEffect(() => {
    if (!isOpen) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const button = anchor.getBoundingClientRect()
    const width = panel.offsetWidth
    setAlignLeft(
      button.right - width < VIEWPORT_MARGIN &&
      button.left + width <= window.innerWidth - VIEWPORT_MARGIN,
    )
  }, [isOpen])

  function add(event: FormEvent) {
    event.preventDefault()
    const name = draft.trim()
    if (name && !columns.includes(name)) onChange([...columns, name])
    setDraft('')
  }

  return (
    <div className="relative" ref={anchorRef}>
      <Button variant="secondary" onClick={() => setIsOpen((open) => !open)}>
        {t.events.columns}{columns.length > 0 ? ` (${columns.length})` : ''}
      </Button>
      {isOpen && (
        <div
          ref={panelRef}
          className={`absolute top-full z-10 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-card border border-border bg-surface-raised p-2 text-sm shadow-card ${
            alignLeft ? 'left-0' : 'right-0'
          }`}
        >
          {columns.map((column) => (
            <div key={column} className="flex items-center justify-between py-0.5">
              <span className="truncate font-mono text-xs text-fg-muted">{column}</span>
              <button
                type="button"
                onClick={() => onChange(columns.filter((name) => name !== column))}
                className="ml-2 text-fg-muted hover:text-fg"
                aria-label={t.events.removeColumn(column)}
              >
                ✕
              </button>
            </div>
          ))}
          <form onSubmit={add}>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t.events.propertyNamePlaceholder}
              className="mt-1 w-full rounded border border-border-strong bg-surface px-2 py-1 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
            />
          </form>
        </div>
      )}
    </div>
  )
}
