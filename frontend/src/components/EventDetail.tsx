import type { Event } from '../types'
import { formatTimestamp } from '../lib/dates'
import { Button } from './ui/Button'
import { LevelBadge } from './LevelBadge'
import { Highlighted } from './Highlighted'
import { JsonTree } from './JsonTree'
import type { Json } from './JsonTree'

interface EventDetailProps {
  event: Event
  highlightTerms: string[]
  onClose: () => void
}

function parseProperties(properties: string | null): Record<string, Json> {
  if (!properties) return {}
  try {
    return JSON.parse(properties) as Record<string, Json>
  } catch {
    return {}
  }
}

export function EventDetail({ event, highlightTerms, onClose }: EventDetailProps) {
  const properties = parseProperties(event.properties)

  return (
    <div className="flex h-full w-[28rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-4 text-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <LevelBadge level={event.level} />
          <span className="tabular font-mono text-xs text-fg-muted">{formatTimestamp(event.timestamp)}</span>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>

      <p className="mb-4 whitespace-pre-wrap break-words">
        <Highlighted text={event.message} terms={highlightTerms} />
      </p>

      {event.exception && (
        <div className="mb-4">
          <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">Exception</h3>
          <pre className="whitespace-pre-wrap break-words rounded-card bg-level-error/[0.06] p-2 font-mono text-xs text-level-error">
            <Highlighted text={event.exception} terms={highlightTerms} />
          </pre>
        </div>
      )}

      {Object.keys(properties).length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">Properties</h3>
          <JsonTree value={properties} />
        </div>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">Raw JSON</h3>
        <pre className="overflow-x-auto rounded-card bg-surface-raised p-2 font-mono text-xs text-fg-muted">
          {JSON.stringify(event, null, 2)}
        </pre>
      </div>
    </div>
  )
}
