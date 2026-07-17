# First-Run Onboarding Panel — Design

**Date:** 2026-07-17
**Status:** Approved (approach A chosen by user)

## Problem

A fresh LogHarbor install greets the user with an empty events table and no hint
of what to do next. The first success moment — seeing your own log line appear —
requires reading docs to learn about API keys, the CLEF endpoint, or OTLP env
vars. todo.md Phase 13: "empty EventsPage shows a 'send your first log' panel …
instead of an empty table."

## Detection: when is it "first run"?

**Approach A (chosen): client-side inference.** EventsPage already knows
everything needed: the search succeeded, the combined filter is empty (no search
text, no level chips, no signal toggles), no explicit time range is set, and the
result is zero events. Under those conditions the server demonstrably has no
matching-anything events, so the onboarding panel renders instead of the empty
list. No new backend endpoint, no extra request.

Rejected: `/healthz eventCount === 0` (extra fetch per page load, false positive
when every event is archived); a dedicated backend flag (overkill).

When any filter/range is active and the result is empty, the existing
"no events match + clear filter" state renders unchanged.

## Panel content (`components/OnboardingPanel.tsx`)

EventsPage renders the panel in place of `VirtualizedEventList` when the
first-run condition holds. `VirtualizedEventList` itself is untouched.

1. **Heading + one-liner** — "Send your first log", short explanation.
2. **API key section**
   - Admin (`useIsAdmin()`): inline create — title input + button calling the
     existing `createApiKey()`; on success the token is shown once with a copy
     button and a "store it now, it is not shown again" warning.
   - Viewer: a note to ask an admin (key creation is admin-only in the backend);
     snippets render with an `<API_KEY>` placeholder.
3. **Three snippet tabs** — content mirrors the ingestion docs verbatim:
   - **curl** (CLEF): `POST {origin}/api/events/raw`, `X-LogHarbor-ApiKey`,
     `Content-Type: application/vnd.serilog.clef` (docs/ingestion-app.md).
   - **Serilog**: `WriteTo.Seq("{origin}", apiKey: "...")` — Seq sinks work
     unchanged (docs/ingestion-app.md).
   - **OTel**: the `OTEL_EXPORTER_OTLP_ENDPOINT={origin}` /
     `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` /
     `OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=...` trio
     (docs/ingestion-otlp.md).
   - `{origin}` comes from `window.location.origin`; once a key is created its
     token replaces the placeholder in all snippets. Each block has a copy
     button. Code blocks are not translated (i18n convention).
4. **"Waiting for your first event…"** — while the panel is visible the events
   query refetches every 5 s; the moment the first event lands the panel is
   replaced by the live list automatically.

## i18n

Panel headings/labels/warnings added to `en.ts` (source of truth) and `tr.ts`.

## Testing (Vitest)

- Panel renders only in the first-run condition; any active filter/level/
  signal/range or a non-empty result suppresses it.
- Viewer does not see the create form; snippets show the placeholder.
- Admin create flow: token appears once and is injected into the snippets.

## Out of scope

Backend changes (none needed), dismiss/"don't show again" state (the panel
disappears naturally with the first event), Settings-page changes.
