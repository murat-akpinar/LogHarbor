# Live Pulse Dashboard — design

Date: 2026-07-24
Status: approved (brainstorm)
Inspiration: Laravel Nightwatch's real-time, connective overview.

## Goal

Turn the current thin `/dashboard` (time-range picker + 4 tiles + histogram +
heatmap) into a dense, real-time "pulse" that shows the whole system at a glance:
throughput, error rate, top errors, recent exceptions, service health, and the
slowest operations — all in one auto-refreshing view.

## Non-goals (deliberately out of scope for v1)

Nightwatch is a full APM. The parts that would require **new ingestion or
instrumentation** stay out, consistent with LogHarbor's product line ("derive
value from data we already collect; full APM rejected"):

- Slow-query capture + N+1 detection (needs per-query events)
- Job/queue execution monitoring (needs job events)
- Cache / mail / notification instrumentation

No SignalR push (polling is enough), **no new backend endpoints**, no chart
library (histogram/heatmap stay hand-rolled per `rules.md`).

## Approach

Upgrade `/dashboard` **in place**. Every panel is composed from **existing**
`/api/stats/*` endpoints; the only new code is frontend composition + a live
refresh loop.

### Data sources (all existing)

| Panel                | Endpoint / hook                          |
|----------------------|------------------------------------------|
| KPI: throughput      | `summary.total` / window minutes         |
| KPI: error rate %    | `(summary.byLevel.Error + Fatal)/total`  |
| KPI: warnings        | `summary.byLevel.Warning`                |
| KPI: top error       | `top-errors?limit=1` (existing card)     |
| Histogram (main)     | `histogram?buckets=24` (kept)            |
| Top errors (5)       | `top-errors?limit=5`                     |
| Recent exceptions (5)| `top-exceptions?limit=5`                 |
| Service health (5)   | `services?limit=5`                       |
| Slowest ops (5)      | `slow-operations?limit=5`                |
| Heatmap              | `heatmap` (kept)                         |

### Layout (bento grid)

```
[ Live ●  ·  last 1h ▾ ]                          header
[ Throughput | Error % | Warnings | Top error ]   KPI row (4 tiles)
[ Histogram — stacked by level, full width ]      main trend
[ Top errors (5)      ] [ Recent exceptions (5) ] two columns
[ Service health (5)  ] [ Slowest ops (5)       ]
[ Heatmap — full width ]
```

The secondary panels are **compact summaries** (top 5 rows, metric + deep link),
NOT the full tables. Each links to its dedicated page:
- Top errors / Slowest ops / Recent exceptions -> `/analysis`
- Service health -> `/services`

No per-row sparklines on these panels: they would multiply the poll load
(5 extra histogram queries per panel). The main histogram carries the trend;
the full pages keep their sparklines.

### Live behavior

- A **Live** toggle in the header (default ON).
- When ON: the range is a rolling `last 1h` ending at "now". `DashboardPage`
  holds a `now` timestamp that ticks every `REFRESH_MS = 10_000` ms (floored to
  the interval so query keys stay stable within a tick). Changing `now` changes
  the range -> React Query refetches all panels; `keepPreviousData` (already the
  hook default) prevents skeleton flashes. The header shows a pulsing dot.
- When OFF: the existing `TimeRangePicker` is shown and drives a static range;
  no auto-refresh. This is today's behavior.
- Polling pauses when the tab is backgrounded (React Query default
  `refetchIntervalInBackground: false` / window-focus behavior). Poll cost is
  ~6 queries / 10 s; load characterization (2026-07-18) measured query p99
  < 90 ms at 1000 ev/s, so this is negligible.

## Components

Reused: `StatTile`, `Histogram`, `Heatmap`, `TimeRangePicker`, `Card`, the
`useStats` hooks (unchanged), `lib/levels` tokens.

New (small, focused, in `frontend/src/components/dashboard/`):
- `LiveToggle` — the on/off control + pulsing indicator.
- `KpiRow` — throughput / error-rate / warnings / top-error tiles.
- `TopErrorsPanel`, `ExceptionsPanel`, `ServicesPanel`, `SlowOpsPanel` — compact
  top-5 lists, each a `Card` with a title and a "view all ->" deep link.

`DashboardPage` composes them and owns `liveMode` + the ticking `now`.

Formatting helpers in `lib/` (reuse or extend): number/percent formatting via the
active `Intl` locale (per the i18n rules); no new dependency.

## i18n

New keys under the `dashboard` namespace in `src/i18n/en.ts` (source) and
`tr.ts`: `live`, `throughput`, `perMinute`, `errorRate`, `recentExceptions`,
`serviceHealth`, `slowestOps`, `viewAll`, `lastHour`, plus the compact-panel
empty states. `en.ts` is the source of truth; `tr.ts` is typed as
`Messages = typeof en`, so a missing key is a compile error.

## Testing

Frontend (Vitest) — extend `DashboardPage.test.tsx`, behavior only:
- KPI tiles render the computed values (error rate % from summary).
- Each compact panel renders its rows and links to the right page.
- Live toggle: ON hides the range picker and shows the live indicator; OFF shows
  the picker. (Assert the mode switch; timer internals are not asserted.)
- Empty states: panels render their empty message when the endpoint returns none.

Backend: unchanged, so no new backend tests; `dotnet test` must stay green.

## Rollout

TDD the components, `npm run test` + `dotnet test` green, verify locally (verify
skill), then deploy to the test server (192.168.1.131) via the standard
git-archive -> Docker rebuild runbook.
