# Trace Timeline from Stored Logs — Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

Events already carry W3C `trace_id`/`span_id` (CLEF `@tr`/`@sp`, OTLP
records — both normalized to lowercase hex, migration 008), the query
language filters on `@TraceId`/`@SpanId`, and EventDetail's "View trace"
button applies the trace filter. But the result is a flat event list; the
shape of the request — which spans ran, when, for how long, where the
errors sit — has to be reconstructed in the reader's head. Phase 14 A —
value from data we already store, no new ingestion, no schema change.

## Approach

Pure frontend. A new `TracePanel` component renders above the Events list
whenever the active filter is exactly a trace filter. No backend changes.

- **Trigger:** the EventsPage filter string matches
  `@TraceId = '<32 lowercase hex>'` (exactly the string "View trace"
  applies via `quote()`; hand-typed filters and `?filter=` deep links hit
  the same path). Any other filter — panel absent.
- **Data:** the panel fetches its own complete set:
  `GET /api/events?filter=@TraceId = '...'&count=1000` through the
  existing api client, React Query key `['trace', traceId]`. Events are
  sorted ascending by timestamp client-side.

## Waterfall semantics

- **Grouping:** events group by `spanId`. Span bounds are the earliest
  and latest event timestamps in the group — an inference from logs, so a
  lower bound on the real span duration. Rows are a flat list ordered by
  span start time (log events carry no parent span id, so no hierarchy).
  Trace-scoped events without a `spanId` collect into one "(no span)"
  row rendered last.
- **Row content:** left — service identity (`service.name` falling back
  to `Service`, same rule as the Services page) plus the span's first
  event message template, truncated with the full text and span id in a
  tooltip. Middle — a bar positioned on the shared time axis with one dot
  per event (dot color from `LEVEL_HEX` by level). Right — span duration
  in ms. A single-event span renders as a dot only, duration "—".
- **Color:** bars are neutral; a span containing an Error or Fatal event
  tints its bar `LEVEL_HEX.Error` (Services sparkline convention).
- **Axis:** footer scale from 0 ms to the trace's total duration
  (last − first timestamp across all fetched events).

## Interaction

Clicking an event dot opens that event's detail: the panel hands its own
copy of the event to the page's existing `selectedEvent` state (which
holds a full `Event` object, so this works even when the list below has
not paged that event in yet). No other interactions — no row click, no
zoom.

## Edge cases

- Fetch saturates at 1000 events → muted note "showing the newest 1000
  events of this trace" (the API pages newest-first).
- No event in the trace carries a `spanId` → instead of a lone
  "(no span)" row, the panel shows a short "this trace carries no span
  ids" message with the event dots on a single timeline.
- Archived days: `/api/events` already reports `archivedDays`; the panel
  adds nothing on top of the existing Events-page behavior.

## Out of scope

Parent/child span hierarchy, span statistics, OTLP `/v1/traces` span
ingestion and a real span waterfall (Phase 14 B, own data model and plan).

## Tests

Frontend only (no backend change):

- `TracePanel.test.tsx`: grouping and ordering from mocked events, span
  duration math, "(no span)" row, error-tinted bar, single-event span as
  dot with "—", dot-click callback carries the event id, the 1000-event
  truncation note, the all-spanless message.
- EventsPage test: panel appears only when the filter is exactly a pure
  `@TraceId` equality; absent otherwise.
- i18n: new `trace.*` strings in both `en.ts` and `tr.ts` (type parity is
  enforced by TypeScript).
