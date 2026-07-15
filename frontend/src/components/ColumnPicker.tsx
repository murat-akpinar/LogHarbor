import { useState } from 'react'
import type { FormEvent } from 'react'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

interface ColumnPickerProps {
  columns: string[]
  onChange: (columns: string[]) => void
}

/** Pick event properties to show as extra list columns. */
export function ColumnPicker({ columns, onChange }: ColumnPickerProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState('')

  function add(event: FormEvent) {
    event.preventDefault()
    const name = draft.trim()
    if (name && !columns.includes(name)) onChange([...columns, name])
    setDraft('')
  }

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setIsOpen((open) => !open)}>
        {t.events.columns}{columns.length > 0 ? ` (${columns.length})` : ''}
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-card border border-border bg-surface-raised p-2 text-sm shadow-card">
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
