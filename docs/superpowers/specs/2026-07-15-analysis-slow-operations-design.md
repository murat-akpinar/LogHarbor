# Analysis — "Slower than usual" (adaptive latency regressions)

**Date:** 2026-07-15
**Status:** approved for planning

## Context

The Analysis page today has **Top errors** (grouped by `@MessageTemplate`, with a
"new" badge for groups unseen before the range) and **Top exceptions**. The user
wants LogHarbor to surface **operations that take longer than normal** — automatically,
in Analysis, **without a manual threshold**. The system should learn each
operation's own "normal" and flag deviations.

Grounding facts:
- LogHarbor is source-agnostic. It does not capture database logs itself; an app's
  slow-query / request logs land in LogHarbor **only if that app sends them** (e.g.
  Serilog `UseSerilogRequestLogging`, EF Core command logging, Vector). They
  arrive as ordinary events with a numeric **duration property**.
- The Serilog/Seq convention for that property is **`Elapsed`** (milliseconds).
- Events are stored in `events(id, timestamp, level, message, message_template,
  properties, exception, ingested_at)`; `properties` is JSON, read with
  `json_extract(properties, '$.<Name>')` (the existing property-values stat does
  exactly this, with `<Name>` restricted to `[A-Za-z0-9_]`).

## Goal

A **"Slower than usual"** section on the Analysis page that automatically lists
operation groups whose latency in the selected range is materially worse than
that group's own historical baseline — no user-set threshold.

## What "slower than usual" means (no threshold, still explainable)

Adaptive, but not machine learning — each operation is compared to **itself**:

- **Group** = `message_template` (the same grouping Top errors uses).
- **Duration** = `json_extract(properties, '$.Elapsed')` as a number (property
  name defaults to `Elapsed`, overridable via a query param).
- **Normal** = the group's **baseline p95** over its history *before* the selected
  range (`BASELINE_START … from`), mirroring how the "new error" baseline works.
- **Now** = the group's **current p95** over the selected range (`from … to`).
- A group is **flagged** when `currentP95 >= factor × baselineP95`, ranked by that
  ratio (largest regression first).

**Guardrails** (internal calibration constants, *not* user-facing thresholds —
without them adaptive detection cries wolf; exposed as query params with defaults
so tests and tuning don't need a redeploy):
- `minSamples` (default 20): a group needs at least this many timed events in
  **each** window, so a 2-event group can't "regress".
- `floorMs` (default 50): ignore groups whose baseline p95 is below this — a
  2 ms → 8 ms jump is 4× but operationally irrelevant.
- `factor` (default 2.0): how many times the baseline p95 counts as "slower".

`// ponytail: p95 via SQLite window functions, three tunable constants as the
calibration knob. Statistical outlier models (mean±3σ, rate-spike) are a research
project — deferred until this proves insufficient.`

## Non-goals

- No live alerting here (that axis is the existing Alerts feature).
- No Settings UI for the duration property in v1 — `Elapsed` default + query-param
  override is enough. Add a Setting later if apps standardise on another name.
- No per-event outlier list — the unit is the operation group.
- No statistical outlier model beyond the baseline-p95 ratio.

## Backend

### Endpoint — `GET /api/stats/slow-operations`

Mirrors `TopErrorsAsync` in `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs`:
- Query params: `from`, `to` (required, ISO-8601), `filter?`, `property?`
  (default `Elapsed`, validated `[A-Za-z0-9_]` like `PropertyValuesAsync`),
  `minSamples?=20`, `floorMs?=50`, `factor?=2.0`, `limit?=20`.
- Reuses `TryValidateCommon` for range/limit/filter; validates `property` and that
  `factor >= 1`, `minSamples >= 1`, `floorMs >= 0`.
- Baseline start is the same sentinel the frontend uses: `2000-01-01T00:00:00Z`.
- Returns `{ operations: SlowOperation[] }`.

### Store — `IEventStore.GetSlowOperationsAsync(...)`

New method on `IEventStore`, implemented in `SqliteEventStore`. Follows
`GetTopErrorsAsync`: call `BuildStatsSourceAsync(connection, command, filter,
"message_template, properties, timestamp", baselineFromUtc, toUtc, ct)` — i.e. the
**wide** window `[BASELINE_START, to)` — then split baseline vs current in SQL by a
distinct `@split` param (= `from`, named to avoid the source's internal range
params). Shape:

```sql
WITH v AS (
  SELECT message_template AS tmpl,
         CAST(json_extract(properties, '$.Elapsed') AS REAL) AS ms,
         CASE WHEN timestamp < @split THEN 0 ELSE 1 END AS cur
  FROM {source}
  WHERE message_template IS NOT NULL
    AND json_extract(properties, '$.Elapsed') IS NOT NULL
),
r AS (   -- ROW_NUMBER (not PERCENT_RANK) so equal durations don't all collapse to rank 0
  SELECT tmpl, cur, ms,
         ROW_NUMBER() OVER (PARTITION BY tmpl, cur ORDER BY ms) AS rn,
         COUNT(*)     OVER (PARTITION BY tmpl, cur) AS n
  FROM v
),
p95 AS (            -- nearest-rank p95: smallest ms among the top 5% by rank
  SELECT tmpl, cur, MAX(n) AS n, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95
  FROM r GROUP BY tmpl, cur
)
SELECT b.tmpl, b.p95 AS base_p95, c.p95 AS cur_p95, c.n AS cur_n,
       c.p95 / b.p95 AS ratio
FROM p95 b JOIN p95 c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1
WHERE b.n >= @minSamples AND c.n >= @minSamples
  AND b.p95 >= @floorMs AND b.p95 > 0          -- floor keeps trivia out and guards the division
  AND c.p95 >= b.p95 * @factor
ORDER BY ratio DESC, c.p95 DESC
LIMIT @limit;
```

`$.Elapsed` is interpolated from the validated `property` (same safe alphabet as
`GetPropertyValuesAsync`). `SlowOperation` record: `Template` (string),
`BaselineP95` (double), `CurrentP95` (double), `Count` (long, current window).

`// ponytail: ROW_NUMBER + FILTER needs SQLite ≥ 3.30; Microsoft.Data.Sqlite
ships newer. Confirm in the first test rather than assuming. Equal-value groups
must survive (a burst where every call takes 5000 ms is still a regression) —
this is the reason for ROW_NUMBER over PERCENT_RANK; the tests cover it.`

## Frontend

- `frontend/src/api/stats.ts` — add `SlowOperation` type and
  `getSlowOperations(params)` (follows `getTopErrors`; the extra params ride along
  in `StatsRangeParams`-style query building).
- `frontend/src/hooks/useStats.ts` — add `useSlowOperations` (copy the
  `useTopErrors` shape, `queryKey: ['stats','slow-operations',params]`).
- `frontend/src/pages/AnalysisPage.tsx` — a third `<section>` **"Slower than
  usual"** below Top exceptions. `<Card>` table: **Operation** (`message_template`,
  mono) · **Usual (p95)** · **Now (p95)** · **×slower** (`(current/baseline)` to 1
  decimal, tinted `text-level-warning`) · **Count** · **Trend** (reuse the existing
  `Sparkline`, filtered to that template). Row click → Events deep-link filtered to
  that template (reuse the page's `openEvents`). Format durations with a small
  `ms → "42 ms" / "5.2 s"` helper.
- Empty states: "No operations are slower than usual." When *no* event in range
  carries the duration property at all, say so instead: "No timed operations found
  (expects an `Elapsed` property)." — distinguishes "nothing regressed" from "no
  duration data", so a user who never sends `Elapsed` isn't left guessing.

Same token system, `Card`, table classes and `TimeRangePicker` already on the page.

## Files

- **Backend**
  - Modify `backend/LogHarbor.Core/Storage/IEventStore.cs` — add `GetSlowOperationsAsync` + `SlowOperation`.
  - Modify `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` — implement it.
  - Modify `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs` — map `/slow-operations`.
  - Test `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs` — add cases.
- **Frontend**
  - Modify `frontend/src/api/stats.ts`, `frontend/src/hooks/useStats.ts`, `frontend/src/pages/AnalysisPage.tsx`.
- **Docs**
  - Modify `docs/api.md` (new stats endpoint) and `docs/frontend.md` (Analysis section).

## Testing & verification

- **Backend (xUnit, TDD):** seed one group with a stable baseline (~40 ms) then a
  slow current window (~5000 ms) → it appears; a group slow in both windows (no
  regression) → absent; a group with < `minSamples` → absent; a fast group under
  `floorMs` → absent. Tests set `minSamples` low so small fixtures work. Also a
  test asserting `PERCENT_RANK … FILTER` runs on the bundled SQLite.
- `dotnet test backend` green; `npm run lint && npm run build && npm run test`.
- Manual on :5000: seed events with an `Elapsed` property where one endpoint
  degrades; confirm it shows in "Slower than usual" with the right ×slower and a
  working row → Events deep link, in both themes.
