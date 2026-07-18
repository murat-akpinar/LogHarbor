import type { Event } from '../types'

/** One waterfall row; spanId null is the trailing row collecting spanless events. */
export interface TraceSpan {
  spanId: string | null
  service: string | null
  /** First event's message template, falling back to its message. */
  label: string
  /** Ascending by timestamp (id breaks ties — insertion order). */
  events: Event[]
  startMs: number
  endMs: number
  hasError: boolean
}

export interface TraceLayout {
  /** Ordered by start time; the spanless row, when present, is last. */
  spans: TraceSpan[]
  startMs: number
  endMs: number
}

/**
 * The trace id when the filter is exactly what "View trace" applies —
 * @TraceId = '<32 lowercase hex>' — optionally in the one pair of parens
 * combineFilter adds. Anything else (chips, signals, extra clauses) means
 * the page is not showing a single trace.
 */
export function matchTraceFilter(filter: string | undefined): string | null {
  if (!filter) return null
  let text = filter.trim()
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim()
  const match = /^@TraceId\s*=\s*'([0-9a-f]{32})'$/.exec(text)
  return match ? match[1] : null
}

/** "service.name" (OTLP) falls back to "Service" (CLEF/Seq) — the Services page rule. */
function serviceOf(event: Event): string | null {
  if (!event.properties) return null
  try {
    const parsed = JSON.parse(event.properties) as Record<string, unknown>
    const value = parsed['service.name'] ?? parsed['Service']
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

export function buildTraceLayout(events: Event[]): TraceLayout | null {
  if (events.length === 0) return null

  const ascending = [...events].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id,
  )

  const groups = new Map<string | null, Event[]>()
  for (const event of ascending) {
    const group = groups.get(event.spanId)
    if (group) group.push(event)
    else groups.set(event.spanId, [event])
  }

  const spans: TraceSpan[] = [...groups.entries()].map(([spanId, group]) => ({
    spanId,
    service: group.map(serviceOf).find((service) => service !== null) ?? null,
    label: group[0].messageTemplate ?? group[0].message,
    events: group,
    startMs: Date.parse(group[0].timestamp),
    endMs: Date.parse(group[group.length - 1].timestamp),
    hasError: group.some((event) => event.level === 'Error' || event.level === 'Fatal'),
  }))

  spans.sort((a, b) => {
    // the spanless bucket always sinks to the bottom
    if ((a.spanId === null) !== (b.spanId === null)) return a.spanId === null ? 1 : -1
    return a.startMs - b.startMs
  })

  return {
    spans,
    startMs: Date.parse(ascending[0].timestamp),
    endMs: Date.parse(ascending[ascending.length - 1].timestamp),
  }
}
