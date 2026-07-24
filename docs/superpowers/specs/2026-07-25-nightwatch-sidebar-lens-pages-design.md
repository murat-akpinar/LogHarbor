# Nightwatch-style sidebar & activity lens pages — design

Date: 2026-07-25
Status: approved (brainstorm)
Inspiration: Laravel Nightwatch's grouped sidebar (Activity → Requests / Jobs /
Queries / Exceptions, each a drill-down page). Continues Phase 16.

## Goal

Two things, shipped together on the `development` branch:

1. Replace the horizontal top nav with a Nightwatch-style **left sidebar** with
   visual group headers (Activity / Analysis / System).
2. Give the two missing activity lenses their own drill-down pages:
   **/requests** (the Operations RED table, promoted out of Analysis) and
   **/exceptions** (live exception feed + inline context panel — closes the two
   remaining unchecked Phase 16 items).

## Non-goals

- **Queries lens: deferred.** Only worth building when the ingested logs
  actually contain DB-query events (e.g. EF Core `Executed DbCommand`).
  Recorded as a todo note, not built now.
- Jobs / Cache / Mail / Notifications lenses: rejected scope (need new
  instrumentation; "full APM rejected" product line).
- **No new backend endpoints.** Every page composes existing `/api/stats/*`,
  events search, and trace reads.

## 1. Sidebar navigation

New `Sidebar` component replaces `NavBar` (~220px, full height, left side):

```
● LogHarbor
  Overview            /            (end match)
  ACTIVITY                         (group header, not clickable)
    Events            /events
    Requests          /requests    (new)
    Exceptions        /exceptions  (new)
  ANALYSIS
    Analysis          /analysis
    Services          /services
    Users             /users
  SYSTEM
    Signals           /signals
    Alerts            /alerts
    Settings          /settings
  ────────── (bottom)
  TR/EN toggle · theme toggle
```

- Group headers are visual separators only (uppercase, muted, small).
- Active link styling mirrors today's NavLink treatment.
- Responsive: on `<md` the sidebar is hidden and a top bar with a hamburger
  opens it as a slide-over drawer (overlay, closes on navigation).
- The app shell (`App.tsx` layout) changes from column (nav on top) to row
  (sidebar left, content right).

## 2. /requests page

The Operations RED table moves from the top of `AnalysisPage` to its own page
(no duplication — Analysis drops the section; Analysis keeps top errors,
exceptions trends, slow ops):

- Columns: message template, count, error %, p95 (Elapsed), sparkline, and
  row click → Events filtered to that template (existing deep-link behavior).
- Data: existing `GET /api/stats/operations`, `limit` raised to 50.
- Client-side column sorting (count / error % / p95).
- Time range: the standard `TimeRangePicker` (same as Analysis today).
- Dashboard's Routes panel "view all" link changes `/analysis` → `/requests`.

## 3. /exceptions page (live feed + context panel)

Closes both open Phase 16 items ("live exception feed", "exception context
panel").

**Feed:** rows from existing `GET /api/stats/top-exceptions` (type, count,
firstSeen, lastSeen), plus a per-row `Sparkline` with filter
`@Exception like '<type>%'` (the component fetches its own histogram — proven
pattern from UsersPage). Live behavior reuses the dashboard pattern: rolling
last-1h window refreshed every 10 s, `LiveToggle` to pause into a static
`TimeRangePicker` range.

**Context panel:** clicking a row expands an inline panel under it:

1. Fetch the most recent matching event via the existing events search endpoint
   with filter `@Exception like '<type>%'` (type string escaped like the
   users-page quoting helper).
2. Show the exception text plus key properties (user, service) of that event.
3. If the event has a `traceId`, fetch the same-trace events (existing trace
   read) and render them as a compact time-ordered list inline — "what happened
   around this error" — with a link out to the full trace waterfall.

Empty states: no exceptions in range; exception with no trace shows the event
context only.

## Components

Reused: `Card`, `Sparkline`, `LiveToggle`, `TimeRangePicker`, `useStats` hooks,
events/trace fetch helpers, `lib/levels`.

New:
- `components/Sidebar.tsx` (replaces `NavBar.tsx`; NavBar tests migrate)
- `pages/RequestsPage.tsx` (extracted from AnalysisPage's Operations section)
- `pages/ExceptionsPage.tsx` + `components/exceptions/ExceptionContextPanel.tsx`

## i18n

New keys in `src/i18n/en.ts` (source of truth) + `tr.ts`: nav group labels
(`activity`, `analysis`, `system`), `nav.requests`, `nav.exceptions`,
`requests.*`, `exceptions.*` (columns, empty states, context-panel labels).

## Testing

Frontend (Vitest), behavior only:
- Sidebar: groups render, active state, drawer opens/closes on small screens.
- RequestsPage: rows render from mocked stats, sorting reorders, row click
  navigates to filtered Events.
- ExceptionsPage: feed rows render; clicking expands the context panel with
  event + trace context; empty states.
- AnalysisPage tests updated (Operations section removed).

Backend unchanged → `dotnet test` must stay green with no new tests.

## Rollout

All commits on the `development` branch; merge to `main` only on explicit user
approval. Deploy to the test server (192.168.1.131) happens after merge, via
the standard git-archive → Docker rebuild runbook. `docs/frontend.md` updated
with the new nav structure and pages.
