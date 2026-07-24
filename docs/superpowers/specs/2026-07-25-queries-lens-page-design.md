# Queries lens page (split master-detail) & nav icons — design

Date: 2026-07-25
Status: approved (brainstorm; user directive: split layout, rich right pane,
deploy to the test server when done)
Inspiration: Laravel Nightwatch's Queries view (Query · Connection · Calls ·
Total · AVG · P95), adapted to LogHarbor's classic top-nav design.

## Goal

1. A `/queries` lens page for database queries derived from already-ingested
   logs, laid out as a **50/50 split**: left half = the query table, right
   half = a detail pane that actually says something (the user finds the
   existing small right-side panels too thin).
2. Small line icons for **every** top-nav link and page title (database
   cylinder for Queries), hand-rolled SVG, no icon library.
3. When done: deploy the `development` build to the test server
   (192.168.1.131) for the user to review. `main` stays untouched.

## Non-goals

- No query capture/instrumentation — the page reads SQL text and durations
  that apps already log (EF Core's `Executed DbCommand` event by default).
- No N+1 detection, no query plans, no per-connection dashboards.
- No layout changes to any other page.

## Data model: what counts as a "query"

A query event is any event carrying a **query-text property** (default
`commandText`, EF Core's property name) . Its duration comes from a **duration
property** (default `elapsed`, EF Core's). Both property names are
configurable in the UI (same pattern as the Users page property input), so
non-EF stacks (e.g. custom `CommandText`/`Elapsed` logging) work too.
Connection name comes from an optional `connection` property when present.

## Backend: GET /api/stats/queries (read-only, no schema change)

Mirrors the existing stats endpoints (validation, auth, limits):

Params: `from`, `to`, `filter?`, `property` (default `commandText`),
`durationProperty` (default `elapsed`), `connectionProperty` (default
`connection`), `limit` (default 50). Property names validated with the same
`[A-Za-z0-9_.]` rule as user-activity.

New store method `GetQueryOverviewAsync` on `IEventStore` +
`SqliteEventStore`: groups events whose query property is non-null by that
property's TEXT value; per group returns

    value        (the SQL text)
    connection   (MAX of the connection property, null when absent)
    calls        COUNT(*)
    totalMs      SUM(duration)     — null when no durations
    avgMs        AVG(duration)     — null when no durations
    p95Ms        ROW_NUMBER percentile, same technique as operations/services
    errorCount   SUM(level IN Error/Fatal)
    lastSeen     MAX(timestamp)

Ordered by totalMs DESC NULLS LAST, then calls DESC. SQL composed from the
same building blocks as `GetUserActivityAsync` (property extraction) and
`GetOperationOverviewAsync` (percentile CTE). DTO record `QueryOverview` in
Core. Endpoint returns `{ queries: [...] }`.

## Frontend: /queries page (QueriesPage)

Layout (fills the viewport height; stacks vertically below `lg`):

```
[ (db) Queries                    property inputs · TimeRangePicker ]
┌──────────────────── 1/2 ───────────────────┬────────── 1/2 ──────────────┐
│ Query (truncated, mono)  Calls Total  P95  │  Selected query detail:     │
│ SELECT * FROM orders...   1.2k  4.1s  12ms │  · full SQL (mono, wrapped, │
│ UPDATE users SET ...       310  2.0s  9ms  │    scrollable)              │
│ ...                                        │  · stat tiles: Calls, Total,│
│ (sortable headers: Calls/Total/AVG/P95)    │    AVG, P95 (+ errors tile  │
│ (row click selects; selected row is        │    when errorCount > 0)     │
│  highlighted)                              │  · Connection · Last seen   │
│                                            │  · trend sparkline (range)  │
│                                            │  · last 5 occurrences       │
│                                            │    (time, level, duration)  │
│                                            │  · "Open in Events →"       │
└────────────────────────────────────────────┴─────────────────────────────┘
```

- Left table columns: Query (single line, truncated), Calls, Total, AVG, P95
  (Connection shown in the detail pane, not as a column — the split costs
  width). Sortable client-side (descending) like RequestsPage; default Total.
- First row auto-selects when results load and nothing is selected.
- Detail pane data: group row (stats) + a small events fetch for the last 5
  occurrences (`<property> = '<value>'` filter, count 5) reusing the events
  API; sparkline reuses the `Sparkline` component with the same filter.
  Numeric-aware quoting is NOT needed (SQL text is always text).
- Row click navigation to Events lives in the detail pane's "Open in Events"
  link (row click selects instead of navigating — different from other lens
  pages, deliberate for master-detail).
- Empty states: no query events at all → explanatory card: what the page
  looks for (`commandText` + `elapsed` properties), how to enable it in EF
  Core, link to docs section. Results but nothing selected → "select a query"
  hint (only reachable by deselecting, so minor).

## Nav icons (all pages)

`components/icons.tsx`: one `NavIcon({ page, className? })` component with a
dictionary of inline SVG paths (16×16 viewBox 24, stroke=currentColor,
strokeWidth 1.8, fill none, lucide-style): dashboard=gauge, events=scroll
list, requests=arrows left-right, exceptions=triangle-alert,
queries=database cylinder, services=server, users=two heads,
analysis=bar-chart, signals=bookmark, alerts=bell, settings=gear.

- NavBar: icon before each label (`flex items-center gap-1.5`); order and
  styling otherwise unchanged; Queries link sits after Exceptions.
- Page `<h1>`s of the lens pages get the same icon before the title.

## i18n

`nav.queries`, new `queries.*` section (title, columns, detail labels, empty
states, property inputs) in `en.ts` + `tr.ts` (typed mirror).

## Test data & docs

- `test/traffic-sim/traffic-sim.py`: web-service events gain an EF-style
  variant — `@mt` "Executed DbCommand ({elapsed}ms) {commandText}" with
  `elapsed` (2–180 ms, occasional 500–2000 outliers) and `commandText` drawn
  from ~6 canned SQL strings, so the page is populated on the test server.
- `docs/ingestion-app.md`: short section "Sending DB query logs" — EF Core:
  Serilog `MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", Information)`;
  custom stacks: log any event with `commandText` + `elapsed` properties.
- `docs/api.md`: document GET /api/stats/queries.
- `docs/frontend.md`: Queries page section + nav order update.

## Testing

- Backend (xUnit): store test for `GetQueryOverviewAsync` (grouping, calls,
  total/avg/p95, connection, null-duration group) + endpoint test in
  `StatsEndpointsTests` (defaults, property validation 400, response shape).
- Frontend (Vitest): QueriesPage — rows render from mocked stats; first row
  auto-selected and detail pane shows full SQL + tiles; clicking another row
  swaps the detail; sort by header; empty state without query events.
  NavBar test: icons don't break labels (order assertion stays green).

## Rollout

TDD on the `development` branch. When green + locally verified: deploy the
development build to 192.168.1.131 via the standard runbook (git archive →
Docker rebuild) for user review. Merge to `main` only after the user's OK.
