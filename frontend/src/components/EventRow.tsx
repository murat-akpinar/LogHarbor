import type { CSSProperties } from 'react'
import type { Event } from '../types'
import { formatRelative, formatTimestamp } from '../lib/dates'
import { LEVEL_BAR } from '../lib/levels'
import { LevelBadge } from './LevelBadge'
import { Highlighted } from './Highlighted'

interface EventRowProps {
  event: Event
  highlightTerms: string[]
  /** Property names shown as extra columns between level and message. */
  columns: string[]
  relativeTime: boolean
  /** Arrived via live tail: flashes once on mount (the animation does not re-run on re-render). */
  isNew: boolean
  isSelected: boolean
  onSelect: (event: Event) => void
  style: CSSProperties
}

function columnValues(propertiesJson: string | null, columns: string[]): string[] {
  if (columns.length === 0) return []
  let properties: Record<string, unknown> = {}
  if (propertiesJson) {
    try {
      properties = JSON.parse(propertiesJson) as Record<string, unknown>
    } catch {
      // unparseable properties render as empty cells
    }
  }
  return columns.map((column) => {
    const value = properties[column]
    if (value === undefined || value === null) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

export function EventRow({
  event,
  highlightTerms,
  columns,
  relativeTime,
  isNew,
  isSelected,
  onSelect,
  style,
}: EventRowProps) {
  const isError = event.level === 'Error' || event.level === 'Fatal'
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      style={style}
      className={`absolute inset-x-0 flex items-center gap-3 border-b border-border pr-3 pl-3 text-left text-sm transition-colors duration-150 hover:bg-surface-hover ${
        isSelected ? 'bg-surface-raised' : isError ? 'bg-level-error/[0.06]' : ''
      } ${isNew ? 'animate-tail-in' : ''}`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-0.5 ${isSelected ? 'bg-accent' : LEVEL_BAR[event.level]}`}
        aria-hidden="true"
      />
      <span
        className={`tabular ${relativeTime ? 'w-24' : 'w-44'} shrink-0 font-mono text-xs text-fg-muted`}
        title={formatTimestamp(event.timestamp)}
      >
        {relativeTime ? formatRelative(event.timestamp) : formatTimestamp(event.timestamp)}
      </span>
      <span className="w-10 shrink-0">
        <LevelBadge level={event.level} />
      </span>
      {columnValues(event.properties, columns).map((value, index) => (
        <span
          key={columns[index]}
          className="w-32 shrink-0 truncate font-mono text-xs text-fg-muted"
          title={value}
        >
          {value}
        </span>
      ))}
      <span className="min-w-0 flex-1 truncate text-fg">
        <Highlighted text={event.message} terms={highlightTerms} />
      </span>
    </button>
  )
}
