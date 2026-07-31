import type { Event } from '../types'
import { formatRelative, formatTimestamp } from '../lib/dates'
import { exceptionLocation } from '../lib/exceptionLocation'
import { propertyEquals } from '../lib/filter'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'
import { LevelBadge } from './LevelBadge'
import { Highlighted } from './Highlighted'
import { CopyButton } from './detail/CopyButton'
import { PropertyRows } from './detail/PropertyRows'
import type { Json } from './JsonTree'

interface EventDetailProps {
  event: Event
  highlightTerms: string[]
  onClose: () => void
  onViewTrace?: (traceId: string) => void
  onFilter?: (filter: string) => void
  onLookAround?: (from: string, to: string) => void
}

// the properties that identify an event at a glance, in the order they read best
const IDENTITY_KEYS = ['Service', 'service.name', 'StatusCode', 'Method', 'Path', 'UserId', 'connection']
const LOOK_AROUND_MS = 2 * 60 * 1000

function parseProperties(properties: string | null): Record<string, Json> {
  if (!properties) return {}
  try {
    return JSON.parse(properties) as Record<string, Json>
  } catch {
    return {}
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">{children}</h3>
}

export function EventDetail({
  event,
  highlightTerms,
  onClose,
  onViewTrace,
  onFilter,
  onLookAround,
}: EventDetailProps) {
  const { t, lang } = useI18n()
  const properties = parseProperties(event.properties)
  const location = event.exception ? exceptionLocation(event.exception) : null

  const chips = IDENTITY_KEYS.flatMap((key) => {
    const value = properties[key]
    if (value === undefined || value === null || typeof value === 'object') return []
    return [{ key, text: String(value) }]
  })

  function lookAround() {
    const center = Date.parse(event.timestamp)
    onLookAround?.(
      new Date(center - LOOK_AROUND_MS).toISOString(),
      new Date(center + LOOK_AROUND_MS).toISOString(),
    )
  }

  return (
    <div className="glass flex h-full w-[28rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-4 text-sm shadow-pop">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <LevelBadge level={event.level} />
          <span
            data-testid="detail-timestamp"
            title={formatTimestamp(event.timestamp, lang)}
            className="tabular truncate font-mono text-xs text-fg-muted"
          >
            {formatRelative(event.timestamp, lang)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onLookAround && (
            <button
              type="button"
              onClick={lookAround}
              aria-label={t.detail.lookAround}
              title={t.detail.lookAround}
              className="rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-accent"
            >
              ⇕
            </button>
          )}
          <Button variant="ghost" onClick={onClose} aria-label={t.common.close}>
            ✕
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-start gap-1">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <Highlighted text={event.message} terms={highlightTerms} />
        </p>
        <CopyButton value={event.message} />
      </div>

      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map(({ key, text }) => (
            <button
              key={key}
              type="button"
              onClick={() => onFilter?.(propertyEquals(key, text))}
              disabled={!onFilter}
              aria-label={`${key}: ${text}`}
              title={onFilter ? t.detail.filterBy(key) : undefined}
              className="rounded-full border border-border bg-surface-inset px-2 py-0.5 font-mono text-xs text-fg-muted transition-all duration-200 enabled:hover:border-accent/40 enabled:hover:bg-accent/10 enabled:hover:text-accent"
            >
              <span className="text-fg-muted">{key}: </span>
              <span className="text-fg">{text}</span>
            </button>
          ))}
        </div>
      )}

      {event.exception && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <SectionHeading>{t.detail.exception}</SectionHeading>
            <CopyButton value={event.exception} />
          </div>
          {location && (
            <p className="mb-1 truncate font-mono text-xs text-level-error" title={location}>
              {location}
            </p>
          )}
          <pre className="whitespace-pre-wrap break-words rounded-card bg-level-error/[0.06] p-2 font-mono text-xs text-level-error">
            <Highlighted text={event.exception} terms={highlightTerms} />
          </pre>
        </div>
      )}

      {event.traceId && (
        <div className="mb-4">
          <SectionHeading>{t.detail.trace}</SectionHeading>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-xs text-fg-muted" title={event.traceId}>
              {event.traceId}
              {event.spanId && ` / ${event.spanId}`}
            </span>
            {onViewTrace && (
              <Button variant="secondary" onClick={() => onViewTrace(event.traceId!)}>
                {t.detail.viewTrace}
              </Button>
            )}
          </div>
        </div>
      )}

      {Object.keys(properties).length > 0 && (
        <div className="mb-4">
          <SectionHeading>{t.detail.properties}</SectionHeading>
          <PropertyRows properties={properties} onFilter={onFilter} />
        </div>
      )}

      <details className="mt-auto">
        <summary className="cursor-pointer text-xs font-semibold uppercase text-fg-muted hover:text-fg">
          {t.detail.rawJson}
        </summary>
        <pre className="mt-1 overflow-x-auto rounded-card bg-surface-inset p-2 font-mono text-xs text-fg-muted">
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </div>
  )
}
