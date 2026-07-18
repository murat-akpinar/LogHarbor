# Trace Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A span waterfall rendered above the Events list whenever the active filter is exactly one trace, built purely from stored log timestamps.

**Architecture:** A pure function in `lib/trace.ts` groups a trace's events into span rows (no backend change); a `TracePanel` component fetches the trace with the existing `/api/events` client and renders bars + per-event dots; `EventsPage` mounts the panel when its combined filter matches `@TraceId = '<hex>'`.

**Tech Stack:** React 18, TypeScript strict, TanStack Query, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-18-trace-timeline-design.md`. Read before Task 1.

## Global Constraints

- TypeScript strict, no `any` (rules.md).
- API calls only through `src/api/` modules; the panel reuses `getEvents` — no new endpoint.
- Tailwind classes for styling; inline `style` is allowed only for computed values (percent positions, LEVEL_HEX colors) — the `Sparkline` precedent.
- All code/comments/commits in English; commit first lines imperative, ≤ 72 chars, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Frontend tests live next to their source file; component tests start with `// @vitest-environment jsdom`, pure-logic tests do not.
- Run all commands from `frontend/`.

---

### Task 1: Trace grouping + filter detection (`lib/trace.ts`)

**Files:**
- Create: `frontend/src/lib/trace.ts`
- Test: `frontend/src/lib/trace.test.ts`

**Interfaces:**
- Consumes: `Event` from `../types` (fields `id`, `timestamp`, `level`, `message`, `messageTemplate`, `properties`, `spanId`).
- Produces (Tasks 2–3 rely on these exact names):
  - `matchTraceFilter(filter: string | undefined): string | null` — the 32-hex trace id when the filter is exactly a trace filter (optionally wrapped in one pair of parens by `combineFilter`), else `null`.
  - `interface TraceSpan { spanId: string | null; service: string | null; label: string; events: Event[]; startMs: number; endMs: number; hasError: boolean }`
  - `interface TraceLayout { spans: TraceSpan[]; startMs: number; endMs: number }`
  - `buildTraceLayout(events: Event[]): TraceLayout | null` — `null` on empty input.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/trace.test.ts`:

```ts
import { expect, it } from 'vitest'
import { buildTraceLayout, matchTraceFilter } from './trace'
import type { Event } from '../types'

const TRACE = '0af7651916cd43dd8448eb211c80319c'

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 1,
    timestamp: '2026-07-18T10:00:00.000Z',
    level: 'Information',
    message: 'msg',
    messageTemplate: null,
    properties: null,
    exception: null,
    ingestedAt: '2026-07-18T10:00:00.000Z',
    traceId: TRACE,
    spanId: null,
    ...overrides,
  }
}

it('matches the exact trace filter, with or without combineFilter parens', () => {
  expect(matchTraceFilter(`@TraceId = '${TRACE}'`)).toBe(TRACE)
  expect(matchTraceFilter(`(@TraceId = '${TRACE}')`)).toBe(TRACE)
})

it('rejects anything that is not exactly one trace filter', () => {
  expect(matchTraceFilter(undefined)).toBeNull()
  expect(matchTraceFilter("@Level = 'Error'")).toBeNull()
  expect(matchTraceFilter(`(@TraceId = '${TRACE}') and @Level = 'Error'`)).toBeNull()
  expect(matchTraceFilter(`@TraceId = 'not-hex'`)).toBeNull()
  expect(matchTraceFilter(`(@TraceId = '${TRACE}'`)).toBeNull()
})

it('groups events into spans ordered by start, bounds from timestamps', () => {
  const layout = buildTraceLayout([
    // API returns newest first; grouping must not depend on input order
    makeEvent({ id: 4, timestamp: '2026-07-18T10:00:00.300Z', spanId: 'b7ad6b7169203331' }),
    makeEvent({ id: 3, timestamp: '2026-07-18T10:00:00.250Z', spanId: 'c8be7c8279314442', level: 'Error', message: 'boom' }),
    makeEvent({ id: 2, timestamp: '2026-07-18T10:00:00.100Z', spanId: 'b7ad6b7169203331', properties: '{"service.name":"checkout"}' }),
    makeEvent({ id: 1, timestamp: '2026-07-18T10:00:00.000Z', spanId: 'c8be7c8279314442', properties: '{"Service":"worker"}' }),
  ])!

  expect(layout.startMs).toBe(Date.parse('2026-07-18T10:00:00.000Z'))
  expect(layout.endMs).toBe(Date.parse('2026-07-18T10:00:00.300Z'))
  expect(layout.spans.map((span) => span.spanId)).toEqual(['c8be7c8279314442', 'b7ad6b7169203331'])
  const [first, second] = layout.spans
  expect(first.service).toBe('worker')
  expect(first.hasError).toBe(true)
  expect(first.endMs - first.startMs).toBe(250)
  expect(second.service).toBe('checkout')
  expect(second.hasError).toBe(false)
  expect(second.events.map((event) => event.id)).toEqual([2, 4])
})

it('collects spanless events into a trailing null-span row', () => {
  const layout = buildTraceLayout([
    makeEvent({ id: 1, timestamp: '2026-07-18T10:00:00.000Z' }),
    makeEvent({ id: 2, timestamp: '2026-07-18T10:00:00.100Z', spanId: 'b7ad6b7169203331' }),
  ])!

  expect(layout.spans.map((span) => span.spanId)).toEqual(['b7ad6b7169203331', null])
})

it('labels a span with its first event template, falling back to message', () => {
  const layout = buildTraceLayout([
    makeEvent({ id: 1, messageTemplate: 'GET {Path}', spanId: 'b7ad6b7169203331' }),
    makeEvent({ id: 2, message: 'plain', spanId: 'c8be7c8279314442' }),
  ])!

  expect(layout.spans.map((span) => span.label)).toEqual(['GET {Path}', 'plain'])
})

it('returns null for no events and survives malformed properties JSON', () => {
  expect(buildTraceLayout([])).toBeNull()
  const layout = buildTraceLayout([makeEvent({ properties: '{oops', spanId: 'b7ad6b7169203331' })])!
  expect(layout.spans[0].service).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/trace.test.ts`
Expected: FAIL — "Failed to resolve import ./trace" (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/trace.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/trace.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trace.ts src/lib/trace.test.ts
git commit -m "feat(trace): span grouping and trace-filter detection helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `TracePanel` component + hook + i18n

**Files:**
- Create: `frontend/src/hooks/useTraceEvents.ts`
- Create: `frontend/src/components/TracePanel.tsx`
- Modify: `frontend/src/i18n/en.ts`, `frontend/src/i18n/tr.ts` (new top-level `trace` block)
- Test: `frontend/src/components/TracePanel.test.tsx`

**Interfaces:**
- Consumes: `buildTraceLayout`, `TraceSpan` from `../lib/trace` (Task 1); `getEvents` from `../api/events` (returns `Promise<EventPage>`, `EventPage = { events: Event[]; hasMore: boolean; archivedDays: string[] }`); `quote` from `../lib/filter`; `LEVEL_HEX: Record<Level, string>` from `../lib/levels`; `useI18n` from `../i18n`.
- Produces (Task 3 relies on): `TracePanel` component with props `{ traceId: string; onSelectEvent: (event: Event) => void }`; `useTraceEvents(traceId: string)` React Query hook, key `['trace', traceId]`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/TracePanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getEvents } from '../api/events'
import type { Event } from '../types'
import { TracePanel } from './TracePanel'

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({ events: [], hasMore: false, archivedDays: [] })),
}))

const TRACE = '0af7651916cd43dd8448eb211c80319c'

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 1,
    timestamp: '2026-07-18T10:00:00.000Z',
    level: 'Information',
    message: 'msg',
    messageTemplate: null,
    properties: null,
    exception: null,
    ingestedAt: '2026-07-18T10:00:00.000Z',
    traceId: TRACE,
    spanId: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderPanel(onSelectEvent: (event: Event) => void = () => {}) {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TracePanel traceId={TRACE} onSelectEvent={onSelectEvent} />
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('renders span rows with service, label, duration and a spanless row', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [
      makeEvent({ id: 3, timestamp: '2026-07-18T10:00:00.250Z', spanId: 'b7ad6b7169203331' }),
      makeEvent({
        id: 2,
        timestamp: '2026-07-18T10:00:00.100Z',
        spanId: 'b7ad6b7169203331',
        messageTemplate: 'GET {Path}',
        properties: '{"service.name":"checkout"}',
      }),
      makeEvent({ id: 1, message: 'orphan log' }),
    ],
    hasMore: false,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('Trace timeline')).toBeDefined()
  expect(screen.getByText('checkout')).toBeDefined()
  expect(screen.getByText('GET {Path}')).toBeDefined()
  expect(screen.getByText('150 ms')).toBeDefined()
  expect(screen.getByText('(no span)')).toBeDefined()
  // the single-event spanless row has no duration
  expect(screen.getByText('—')).toBeDefined()
})

it('hands the clicked dot event to onSelectEvent', async () => {
  const boom = makeEvent({
    id: 2,
    timestamp: '2026-07-18T10:00:00.100Z',
    spanId: 'b7ad6b7169203331',
    level: 'Error',
    message: 'boom',
  })
  vi.mocked(getEvents).mockResolvedValue({
    events: [boom, makeEvent({ id: 1, spanId: 'b7ad6b7169203331' })],
    hasMore: false,
    archivedDays: [],
  })
  const onSelectEvent = vi.fn()
  renderPanel(onSelectEvent)

  ;(await screen.findByRole('button', { name: 'Error: boom' })).click()
  expect(onSelectEvent).toHaveBeenCalledWith(boom)
})

it('notes truncation when the API reports more events than fetched', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [makeEvent({ id: 1, spanId: 'b7ad6b7169203331' })],
    hasMore: true,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('Showing the newest 1000 events of this trace.')).toBeDefined()
})

it('explains when the whole trace carries no span ids', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [makeEvent({ id: 1 }), makeEvent({ id: 2, timestamp: '2026-07-18T10:00:00.100Z' })],
    hasMore: false,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('This trace carries no span ids; events sit on one timeline.')).toBeDefined()
  expect(screen.queryByText('(no span)')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/TracePanel.test.tsx`
Expected: FAIL — "Failed to resolve import ./TracePanel".

- [ ] **Step 3: Add the i18n strings**

In `frontend/src/i18n/en.ts`, insert a top-level `trace` block immediately after the `detail` block (the one containing `viewTrace: 'View trace'`):

```ts
  trace: {
    title: 'Trace timeline',
    noSpan: '(no span)',
    noSpanIds: 'This trace carries no span ids; events sit on one timeline.',
    truncated: 'Showing the newest 1000 events of this trace.',
    dotAria: (level: string, message: string) => `${level}: ${message}`,
  },
```

In `frontend/src/i18n/tr.ts`, same position (after the block containing `viewTrace: 'İzi görüntüle'`):

```ts
  trace: {
    title: 'İz zaman çizelgesi',
    noSpan: '(span yok)',
    noSpanIds: 'Bu iz span kimliği taşımıyor; olaylar tek zaman çizgisinde.',
    truncated: 'Bu izin en yeni 1000 olayı gösteriliyor.',
    dotAria: (level: string, message: string) => `${level}: ${message}`,
  },
```

- [ ] **Step 4: Write the hook**

Create `frontend/src/hooks/useTraceEvents.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { getEvents } from '../api/events'
import { quote } from '../lib/filter'

/** The whole trace in one fetch; the API caps count at 1000, newest first. */
export function useTraceEvents(traceId: string) {
  return useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => getEvents({ filter: `@TraceId = ${quote(traceId)}`, count: 1000 }),
  })
}
```

- [ ] **Step 5: Write the component**

Create `frontend/src/components/TracePanel.tsx`:

```tsx
import { useMemo } from 'react'
import type { Event } from '../types'
import { useTraceEvents } from '../hooks/useTraceEvents'
import { buildTraceLayout } from '../lib/trace'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

interface TracePanelProps {
  traceId: string
  onSelectEvent: (event: Event) => void
}

/** Span waterfall inferred from the trace's log timestamps — bounds are the
 * earliest/latest event per span, a lower bound on the real span duration. */
export function TracePanel({ traceId, onSelectEvent }: TracePanelProps) {
  const { t, lang } = useI18n()
  const trace = useTraceEvents(traceId)
  const layout = useMemo(() => buildTraceLayout(trace.data?.events ?? []), [trace.data])

  if (!layout) return null

  const totalMs = Math.max(1, layout.endMs - layout.startMs)
  const percent = (ms: number) => `${((ms - layout.startMs) / totalMs) * 100}%`
  const allSpanless = layout.spans.every((span) => span.spanId === null)

  // when the whole trace is spanless the noSpanIds message already explains the
  // single row, so the "(no span)" label would be noise
  const rowLabel = (spanId: string | null, label: string) =>
    spanId === null ? (allSpanless ? '' : t.trace.noSpan) : label

  return (
    <div className="shrink-0 border-b border-border bg-surface p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-fg">{t.trace.title}</h2>
        <span className="truncate font-mono text-xs text-fg-muted" title={traceId}>
          {traceId}
        </span>
      </div>

      {allSpanless && <p className="mb-2 text-xs text-fg-muted">{t.trace.noSpanIds}</p>}
      {trace.data?.hasMore && <p className="mb-2 text-xs text-fg-muted">{t.trace.truncated}</p>}

      <div className="max-h-56 overflow-y-auto">
        {layout.spans.map((span) => (
          <div
            key={span.spanId ?? 'no-span'}
            className="grid grid-cols-[minmax(8rem,16rem)_1fr_5rem] items-center gap-2 py-0.5"
          >
            <span
              className="truncate text-xs text-fg"
              title={span.spanId ? `${span.label} — ${span.spanId}` : rowLabel(span.spanId, span.label)}
            >
              {span.service && <span className="mr-1 font-mono text-fg-muted">{span.service}</span>}
              {rowLabel(span.spanId, span.label)}
            </span>
            <div className="relative h-4">
              {span.endMs > span.startMs && (
                <div
                  aria-hidden="true"
                  className="absolute top-1 h-2 rounded-sm opacity-40"
                  style={{
                    left: percent(span.startMs),
                    width: `${((span.endMs - span.startMs) / totalMs) * 100}%`,
                    backgroundColor: span.hasError ? LEVEL_HEX.Error : LEVEL_HEX.Information,
                  }}
                />
              )}
              {span.events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  aria-label={t.trace.dotAria(event.level, event.message)}
                  title={t.trace.dotAria(event.level, event.message)}
                  onClick={() => onSelectEvent(event)}
                  className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full border border-bg"
                  style={{
                    left: percent(Date.parse(event.timestamp)),
                    backgroundColor: LEVEL_HEX[event.level],
                  }}
                />
              ))}
            </div>
            <span className="tabular text-right text-xs text-fg-muted">
              {span.endMs > span.startMs
                ? `${Math.round(span.endMs - span.startMs).toLocaleString(lang)} ms`
                : '—'}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-[minmax(8rem,16rem)_1fr_5rem] gap-2 text-[10px] text-fg-muted">
        <span />
        <span className="flex justify-between">
          <span>0 ms</span>
          <span>{Math.round(layout.endMs - layout.startMs).toLocaleString(lang)} ms</span>
        </span>
        <span />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/components/TracePanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useTraceEvents.ts src/components/TracePanel.tsx src/components/TracePanel.test.tsx src/i18n/en.ts src/i18n/tr.ts
git commit -m "feat(trace): TracePanel span waterfall component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: EventsPage wiring + docs

**Files:**
- Modify: `frontend/src/pages/EventsPage.tsx` (imports block; the render tree right before `<div className="flex min-h-0 flex-1">`)
- Modify: `docs/frontend.md` (EVENTS PAGE section)
- Test: `frontend/src/pages/EventsPage.test.tsx` (append two tests)

**Interfaces:**
- Consumes: `TracePanel` (Task 2), `matchTraceFilter` (Task 1), the page's existing `filter` memo and `setSelectedEvent` state setter.
- Produces: nothing consumed later; final user-facing wiring.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/pages/EventsPage.test.tsx`:

```tsx
const TRACE = '0af7651916cd43dd8448eb211c80319c'

it('shows the trace timeline panel when the filter is exactly a trace filter', async () => {
  const traced = { ...SAMPLE_EVENT, id: 2, traceId: TRACE, spanId: 'b7ad6b7169203331' }
  vi.mocked(getEvents).mockResolvedValue({ events: [traced], hasMore: false, archivedDays: [] })
  renderPage('/?filter=' + encodeURIComponent(`@TraceId = '${TRACE}'`))

  expect(await screen.findByText('Trace timeline')).toBeDefined()
})

it('keeps the trace panel hidden for non-trace filters', async () => {
  vi.mocked(getEvents).mockResolvedValue({ events: [SAMPLE_EVENT], hasMore: false, archivedDays: [] })
  renderPage('/?filter=' + encodeURIComponent("@Level = 'Error'"))

  expect(await screen.findByText('hello there')).toBeDefined()
  expect(screen.queryByText('Trace timeline')).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npx vitest run src/pages/EventsPage.test.tsx`
Expected: the trace-panel test FAILS ("Unable to find an element with the text: Trace timeline"); the hidden-case test passes vacuously; the three pre-existing tests still pass.

- [ ] **Step 3: Wire the panel**

In `frontend/src/pages/EventsPage.tsx`:

Add imports (next to the other component/lib imports):

```tsx
import { matchTraceFilter } from '../lib/trace'
import { TracePanel } from '../components/TracePanel'
```

Add the memo directly under the existing `highlightTerms` memo:

```tsx
const traceId = useMemo(() => matchTraceFilter(filter), [filter])
```

Render the panel immediately before `<div className="flex min-h-0 flex-1">`:

```tsx
{traceId && <TracePanel traceId={traceId} onSelectEvent={setSelectedEvent} />}
```

- [ ] **Step 4: Run the full frontend suite and build**

Run: `npx vitest run` — Expected: PASS, all files.
Run: `npm run build` — Expected: tsc + vite complete with no errors.

- [ ] **Step 5: Update docs**

In `docs/frontend.md`, at the end of the EVENTS PAGE section (before the next `---` heading), append:

```
Trace timeline: when the filter is exactly @TraceId = '...' (what the detail
pane's "View trace" button applies), a waterfall panel renders above the list:
one row per span_id, bounds inferred from the span's earliest/latest event
timestamps (a lower bound on real span duration), one dot per event colored by
level, bars tinted red when the span carries an Error/Fatal event. Spanless
events collect into a trailing "(no span)" row. Clicking a dot opens that
event's detail. Pure frontend over GET /api/events (count=1000, newest first;
a note appears when the trace has more).
```

In `todo.md` (gitignored — no commit), mark the Phase 14 A trace timeline item `[x]` with a DONE note pointing at the spec.

- [ ] **Step 6: Commit**

```bash
git add src/pages/EventsPage.tsx src/pages/EventsPage.test.tsx ../docs/frontend.md
git commit -m "feat(trace): show trace timeline panel on Events page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
