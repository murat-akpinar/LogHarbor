import type { ReactNode } from 'react'
import type { Event } from '../types'
import { formatRelative, formatTimestamp } from '../lib/dates'
import { exceptionLocation } from '../lib/exceptionLocation'
import { parseStackTrace } from '../lib/stackTrace'
import { propertyEquals } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'
import { Panel } from './ui/Panel'
import { LevelBadge } from './LevelBadge'
import { Highlighted } from './Highlighted'
import { CopyButton } from './detail/CopyButton'
import { PropertyRows } from './detail/PropertyRows'
import { StackTrace } from './detail/StackTrace'
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

/** Two arrows leaving a line: the minutes either side of this event. */
function AroundIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M4 12h16M12 4v4m0 8v4M9 7l3-3 3 3M9 17l3 3 3-3" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** A header action: a real target rather than a glyph sitting in text. */
function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-lg text-fg-muted transition-colors duration-200 hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

/**
 * One block of the drawer: an eyebrow, an optional count, an optional action, then a well.
 *
 * The same plate-and-well rhythm the pages use, at the scale a 28rem column can carry — the
 * drawer used to be flat text under bare small-caps headings, which made a long property list
 * and a stack trace look like the same kind of thing.
 */
function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string
  meta?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-baseline gap-2 text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase">
          <span className="truncate">{title}</span>
          {meta && <span className="tabular shrink-0 font-normal text-fg-subtle">{meta}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
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
  // whether the trace parsed into frames at all decides which of the two shapes is drawn
  const readable = event.exception !== null && parseStackTrace(event.exception).frames.length > 0
  const propertyCount = Object.keys(properties).length

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
    <aside className="glass absolute inset-y-0 right-0 z-20 flex w-[28rem] flex-col overflow-hidden border-l border-border bg-surface-float text-sm shadow-pop">
      {/* the level's own hue along the top edge: what kind of event this is, before a word of
          it has been read. The same device the glance band uses to tell its tiles apart. */}
      <span
        className="h-0.5 shrink-0"
        style={{ background: `linear-gradient(90deg, ${LEVEL_HEX[event.level]}, transparent 85%)` }}
        aria-hidden="true"
      />

      {/* fixed, not scrolled away: on an event with forty properties the level, the time and
          the way out are exactly what you still want at the bottom of the list */}
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LevelBadge level={event.level} pill />
            <span
              data-testid="detail-timestamp"
              title={formatTimestamp(event.timestamp, lang)}
              className="tabular truncate font-mono text-xs text-fg-muted"
            >
              {formatRelative(event.timestamp, lang)}
            </span>
          </div>
          <p className="tabular mt-1 truncate font-mono text-[0.625rem] text-fg-subtle">
            {formatTimestamp(event.timestamp, lang)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onLookAround && (
            <IconButton onClick={lookAround} label={t.detail.lookAround}>
              <AroundIcon />
            </IconButton>
          )}
          <IconButton onClick={onClose} label={t.common.close}>
            <CloseIcon />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* the message is what the reader clicked for, so it gets the first well and room to
            wrap rather than being a paragraph competing with the headings under it */}
        <Panel className="flex items-start gap-1 p-3">
          <p className="min-w-0 flex-1 leading-relaxed break-words whitespace-pre-wrap text-fg">
            <Highlighted text={event.message} terms={highlightTerms} />
          </p>
          <CopyButton value={event.message} />
        </Panel>

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map(({ key, text }) => (
              <button
                key={key}
                type="button"
                onClick={() => onFilter?.(propertyEquals(key, text))}
                disabled={!onFilter}
                aria-label={`${key}: ${text}`}
                title={onFilter ? t.detail.filterBy(key) : undefined}
                className="rounded-full border border-border bg-surface-inset px-2 py-0.5 font-mono text-xs transition-all duration-200 enabled:hover:border-accent/40 enabled:hover:bg-accent/10 enabled:hover:text-accent"
              >
                <span className="text-fg-subtle">{key}: </span>
                <span className="text-fg">{text}</span>
              </button>
            ))}
          </div>
        )}

        {event.exception && (
          <Section title={t.detail.exception} action={<CopyButton value={event.exception} />}>
            {/* the pill said "path:line" of the first frame carrying a file. The trace itself
                marks that frame now, so keeping it would print the same fact twice — it stays
                only for a trace no runtime reader recognised, which draws as plain text */}
            {location && !readable && (
              <p
                className="mb-1.5 truncate rounded-md bg-level-error/10 px-2 py-1 font-mono text-xs text-level-error"
                title={location}
              >
                {location}
              </p>
            )}
            <StackTrace text={event.exception} highlightTerms={highlightTerms} />
          </Section>
        )}

        {event.traceId && (
          <Section title={t.detail.trace}>
            <Panel className="flex items-center justify-between gap-2 p-2.5">
              <span className="min-w-0 truncate font-mono text-xs text-fg-muted" title={event.traceId}>
                {event.traceId}
                {event.spanId && <span className="text-fg-subtle"> / {event.spanId}</span>}
              </span>
              {onViewTrace && (
                <Button variant="secondary" onClick={() => onViewTrace(event.traceId!)} className="shrink-0">
                  {t.detail.viewTrace}
                </Button>
              )}
            </Panel>
          </Section>
        )}

        {propertyCount > 0 && (
          <Section title={t.detail.properties} meta={propertyCount.toLocaleString(lang)}>
            <Panel className="px-2 py-1">
              <PropertyRows properties={properties} onFilter={onFilter} />
            </Panel>
          </Section>
        )}

        {/* its own eyebrow rather than a Section, because the disclosure arrow has to sit on
            the heading — that is the only thing saying the block opens */}
        <details className="group mt-4">
          <summary className="mb-1.5 inline-flex cursor-pointer list-none items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase transition-colors hover:text-fg">
            <span className="transition-transform duration-200 group-open:rotate-90" aria-hidden="true">
              ›
            </span>
            {t.detail.rawJson}
          </summary>
          <pre className="rounded-well overflow-x-auto bg-surface-inset p-3 font-mono text-xs leading-relaxed text-fg-muted">
            {JSON.stringify(event, null, 2)}
          </pre>
        </details>
      </div>
    </aside>
  )
}
