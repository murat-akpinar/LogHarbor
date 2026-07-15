import { useState } from 'react'
import { chipLabel, compileChips, parseChips, type Chip } from '../lib/filterChips'
import { FilterEditor } from './FilterEditor'
import { SearchBar } from './SearchBar'
import { Button } from './ui/Button'

interface FilterBarProps {
  initialText?: string
  onCommit: (filter: string) => void
}

export function FilterBar({ initialText = '', onCommit }: FilterBarProps) {
  const parsed = parseChips(initialText)
  const [chips, setChips] = useState<Chip[]>(parsed ?? [])
  // non-null => raw mode (a filter too complex for chips); null => chip mode
  const [raw, setRaw] = useState<string | null>(parsed ? null : initialText)
  // null => closed; { index:null } => adding; { index:n } => editing chip n
  const [editing, setEditing] = useState<{ index: number | null } | null>(null)

  function commit(next: Chip[]) {
    setChips(next)
    onCommit(compileChips(next))
  }

  function upsert(chip: Chip) {
    if (editing && editing.index !== null) {
      const next = chips.slice()
      next[editing.index] = chip
      commit(next)
    } else {
      commit([...chips, chip])
    }
    setEditing(null)
  }

  if (raw !== null) {
    return (
      <div>
        <SearchBar
          initialText={raw}
          onCommit={(text) => {
            const back = parseChips(text)
            if (back) {
              setChips(back)
              setRaw(null)
              onCommit(compileChips(back))
            } else {
              setRaw(text)
              onCommit(text)
            }
          }}
        />
        <button
          type="button"
          className="mt-1 text-xs text-fg-muted underline hover:text-fg"
          onClick={() => {
            commit([])
            setRaw(null)
          }}
        >
          Clear and use filters
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 rounded-lg border border-border-strong bg-surface-raised py-1 pr-1 pl-2 text-xs"
        >
          <button
            type="button"
            className="font-mono text-fg hover:text-accent"
            onClick={() => setEditing({ index })}
          >
            {chipLabel(chip)}
          </button>
          <button
            type="button"
            aria-label="Remove filter"
            className="rounded px-1 text-fg-muted hover:text-fg"
            onClick={() => commit(chips.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </span>
      ))}
      <div className="relative">
        <Button variant="secondary" onClick={() => setEditing((current) => (current ? null : { index: null }))}>
          + Add filter
        </Button>
        {editing && (
          <FilterEditor
            initial={editing.index !== null ? chips[editing.index] : undefined}
            onSubmit={upsert}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
      <button
        type="button"
        className="ml-auto text-xs text-fg-muted underline hover:text-fg"
        onClick={() => setRaw(compileChips(chips))}
      >
        Edit as query
      </button>
    </div>
  )
}
