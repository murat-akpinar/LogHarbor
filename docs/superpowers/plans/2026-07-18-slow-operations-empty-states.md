# Slow-Operations Empty States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Analysis "Slower than usual" card explain *why* it is empty — no timed data, no baseline to compare, or nothing regressed — instead of showing the same "no slowdown" message in all three cases.

**Architecture:** `GET /api/stats/slow-operations` returns two extra counts alongside `operations`. The store computes them from the same `WITH v … r … p …` CTE it already builds for the rows, as a second statement over the same connection (SQLite CTEs do not span statements, so the CTE text is extracted into one shared fragment and re-declared in both statements). The frontend card renders exactly one of four states off the loaded response.

**Tech Stack:** .NET 8 / ASP.NET Core Minimal API, SQLite (Microsoft.Data.Sqlite), xUnit; React 18 + TypeScript, @tanstack/react-query, Vitest.

## Global Constraints

- Design source: `docs/superpowers/specs/2026-07-16-slow-operations-empty-states-design.md` (approved).
- **Baseline semantics stay unchanged.** Baseline = the group's entire history before `from` (`baselineFromUtc` = `2000-01-01`, split = `from`). No trailing window.
- **The page's 24 h default stays.** The fix teaches the user to narrow the range, it does not change the range.
- `TimedOperationCount` is **not** gated by `minSamples` and **not** by `floorMs` — it answers "is any duration data arriving?" (a setup question). A group with 3 samples still counts as timed.
- `ComparableOperationCount` = groups with `>= minSamples` samples in **both** windows. `floorMs` and `factor` do **not** enter it.
- Parameterized SQL only; `property` is already validated to `[A-Za-z0-9_.]` at the API boundary — do not change that.
- JSON is camelCase (ASP.NET default): the `SlowOperationsResult` record serializes to `{ operations, timedOperationCount, comparableOperationCount }`.
- New i18n strings go in BOTH `frontend/src/i18n/en.ts` and `frontend/src/i18n/tr.ts`; the property name (`Elapsed`) stays interpolated in the "no timed data" message so it names the actual property.
- Backend test: `dotnet test backend`. Frontend test: `npm run test` (in `frontend/`). Frontend typecheck/build: `npm run build` (in `frontend/`).

---

### Task 1: Backend — two counts in the slow-operations response

**Files:**
- Modify: `backend/LogHarbor.Core/Storage/IEventStore.cs:25` (add result record) and `:68-71` (change return type)
- Modify: `backend/LogHarbor.Core/Storage/SqliteEventStore.cs:447-492` (rewrite `GetSlowOperationsAsync`)
- Modify: `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs:98-101` (return the result)
- Test: `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs` (add one test; existing `SlowOperations_FlagsGroupsSlowerThanTheirBaseline` must keep passing unchanged)
- Docs: `docs/api.md:195` (response shape + what the counts mean)

**Interfaces:**
- Produces: `SlowOperationsResult(IReadOnlyList<SlowOperation> Operations, long TimedOperationCount, long ComparableOperationCount)` — Task 2 consumes the JSON shape `{ operations, timedOperationCount, comparableOperationCount }`.
- `GetSlowOperationsAsync(...)` return type changes from `Task<IReadOnlyList<SlowOperation>>` to `Task<SlowOperationsResult>`; all parameters stay identical.

- [ ] **Step 1: Write the failing test**

Add to `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs` (after `SlowOperations_FlagsGroupsSlowerThanTheirBaseline`, before the `[Theory]`). Each test method gets a fresh `LogHarborApiFactory` (fresh DB), so only these seeds + the day-13/14 `InitializeAsync` seeds (none carry `Elapsed`) exist; the analysed day 2026-07-17 is otherwise untouched.

```csharp
    [Fact]
    public async Task SlowOperations_ReportsTimedAndComparableCounts()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        var batch = new List<Event>();
        // "Cold {Path}": timed samples only in the current window, no baseline before `from`
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-17T10:10:00.0000000Z", "Cold {Path}", 100 + i));
        // "Even {Path}": timed samples in both windows, same level => comparable but not regressed
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-17T09:00:00.0000000Z", "Even {Path}", 200 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-17T10:10:00.0000000Z", "Even {Path}", 200 + i));
        // "Thin {Path}": only 2 current-window samples (below minSamples=3) => still counts as timed
        for (var i = 0; i < 2; i++) batch.Add(Timed("2026-07-17T10:10:00.0000000Z", "Thin {Path}", 300 + i));
        await store.WriteBatchAsync(batch);

        var body = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/slow-operations?from=2026-07-17T10:00:00Z&to=2026-07-17T11:00:00Z&minSamples=3&floorMs=10&factor=2");

        Assert.Empty(body.GetProperty("operations").EnumerateArray());
        // Cold, Even and Thin all have current-window samples; timed is NOT gated by minSamples,
        // so Thin (2 < 3) is still counted
        Assert.Equal(3, body.GetProperty("timedOperationCount").GetInt64());
        // only Even has >= minSamples in BOTH windows
        Assert.Equal(1, body.GetProperty("comparableOperationCount").GetInt64());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test backend --filter SlowOperations_ReportsTimedAndComparableCounts`
Expected: FAIL — `timedOperationCount` property is missing (`KeyNotFoundException`/`InvalidOperationException` from `GetProperty`), because the endpoint still returns `{ operations }` only.

- [ ] **Step 3: Add the result record and change the interface return type**

In `backend/LogHarbor.Core/Storage/IEventStore.cs`, immediately after the `SlowOperation` record (line 25):

```csharp
/// <summary>Regressed groups plus why the list may be empty:
/// TimedOperationCount = groups with >= 1 timed sample in [from, to) (a setup check, not gated by minSamples);
/// ComparableOperationCount = groups with >= minSamples samples in BOTH windows (eligible for the ratio test).</summary>
public sealed record SlowOperationsResult(
    IReadOnlyList<SlowOperation> Operations, long TimedOperationCount, long ComparableOperationCount);
```

In the same file, change the method signature (line 68):

```csharp
    Task<SlowOperationsResult> GetSlowOperationsAsync(
        QuerySql? filter, string baselineFromUtc, string splitUtc, string toUtc,
        string property, int minSamples, double floorMs, double factor, int limit,
        CancellationToken cancellationToken = default);
```

- [ ] **Step 4: Rewrite the store method to run two statements over one shared CTE**

Replace the body of `GetSlowOperationsAsync` in `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` (lines 447-492) with:

```csharp
    public async Task<SlowOperationsResult> GetSlowOperationsAsync(
        QuerySql? filter, string baselineFromUtc, string splitUtc, string toUtc,
        string property, int minSamples, double floorMs, double factor, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        // wide window [baseline, to); the baseline/current split happens in SQL by @split
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "message_template, properties, timestamp",
            baselineFromUtc, toUtc, cancellationToken);

        // safe to embed: property is restricted to [A-Za-z0-9_.] at the API boundary;
        // the quoted step keeps dots literal
        var extract = $"json_extract(properties, '$.\"{property}\"')";
        // shared prefix: SQLite CTEs do not span statements, so it is re-declared in both below
        var cte =
            "WITH v AS (" +
            $"SELECT message_template AS tmpl, CAST({extract} AS REAL) AS ms, " +
            "CASE WHEN timestamp < @split THEN 0 ELSE 1 END AS cur " +
            $"FROM {source} WHERE message_template IS NOT NULL AND {extract} IS NOT NULL), " +
            // ROW_NUMBER (not PERCENT_RANK) so a burst of equal durations doesn't collapse to rank 0
            "r AS (SELECT tmpl, cur, ms, " +
            "ROW_NUMBER() OVER (PARTITION BY tmpl, cur ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY tmpl, cur) AS n FROM v), " +
            "p AS (SELECT tmpl, cur, MAX(n) AS n, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 " +
            "FROM r GROUP BY tmpl, cur) ";
        command.CommandText =
            cte +
            "SELECT b.tmpl, b.p95 AS base_p95, c.p95 AS cur_p95, c.n AS cur_n " +
            "FROM p b JOIN p c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1 " +
            "WHERE b.n >= @minSamples AND c.n >= @minSamples AND b.p95 >= @floorMs AND b.p95 > 0 " +
            "AND c.p95 >= b.p95 * @factor " +
            "ORDER BY c.p95 / b.p95 DESC, c.p95 DESC LIMIT @limit; " +
            // counts over the same CTE: timed = any current-window sample (not gated by minSamples);
            // comparable = >= minSamples in both windows (no floorMs/factor)
            cte +
            "SELECT (SELECT COUNT(*) FROM p WHERE cur = 1) AS timed, " +
            "(SELECT COUNT(*) FROM p b JOIN p c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1 " +
            "WHERE b.n >= @minSamples AND c.n >= @minSamples) AS comparable;";
        command.Parameters.AddWithValue("@split", splitUtc);
        command.Parameters.AddWithValue("@minSamples", minSamples);
        command.Parameters.AddWithValue("@floorMs", floorMs);
        command.Parameters.AddWithValue("@factor", factor);
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<SlowOperation>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new SlowOperation(
                reader.GetString(0), reader.GetDouble(1), reader.GetDouble(2), reader.GetInt64(3)));
        }
        long timed = 0, comparable = 0;
        if (await reader.NextResultAsync(cancellationToken) && await reader.ReadAsync(cancellationToken))
        {
            timed = reader.GetInt64(0);
            comparable = reader.GetInt64(1);
        }
        return new SlowOperationsResult(rows, timed, comparable);
    }
```

- [ ] **Step 5: Return the result from the endpoint**

In `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs`, replace lines 98-101:

```csharp
        var result = await eventStore.GetSlowOperationsAsync(
            filterSql, BaselineStart, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, minSamples, floorMs, factor, limit, cancellationToken);
        return Results.Ok(result);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test backend --filter SlowOperations`
Expected: PASS — both `SlowOperations_ReportsTimedAndComparableCounts` and `SlowOperations_FlagsGroupsSlowerThanTheirBaseline` (its `operations`/`count`/`currentP95`/`baselineP95` assertions are unaffected by the extra top-level fields).

Then run the whole backend suite to prove nothing else broke:
Run: `dotnet test backend`
Expected: PASS (all green).

- [ ] **Step 7: Update docs/api.md**

In `docs/api.md`, replace line 195 (`200: { "operations": …` for slow-operations) with:

```
  200: { "operations": [ { template, baselineP95, currentP95, count } ],
         "timedOperationCount": N,        // groups with >= 1 timed sample in [from, to)
         "comparableOperationCount": N }  // groups with >= minSamples in BOTH windows
  timedOperationCount is 0 when no event in the range carries the property; when it is
  non-zero but comparableOperationCount is 0, no group has a baseline before `from` to
  compare against (narrow the range). The two counts let the UI explain an empty list.
```

- [ ] **Step 8: Commit**

```bash
git add backend/LogHarbor.Core/Storage/IEventStore.cs backend/LogHarbor.Core/Storage/SqliteEventStore.cs backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs docs/api.md
git commit -m "feat(analysis): slow-operations reports timed and comparable counts"
```

---

### Task 2: Frontend — four-state empty card and slow error in the banner

**Files:**
- Modify: `frontend/src/types/index.ts:81` (add `SlowOperationsResult` interface after `SlowOperation`)
- Modify: `frontend/src/api/stats.ts:2` (import) and `:42-46` (`getSlowOperations` return type)
- Modify: `frontend/src/i18n/en.ts:180-181` and `frontend/src/i18n/tr.ts:182-183` (replace the two `noSlowOps*` keys with four keys)
- Modify: `frontend/src/pages/AnalysisPage.tsx:17` (const), `:59` (queryError), `:203-209` (four-state block)
- Test: `frontend/src/pages/AnalysisPage.test.tsx` (update mock shape, add three tests)
- Docs: `docs/frontend.md:141-145` (the card's empty states)

**Interfaces:**
- Consumes: JSON `{ operations, timedOperationCount, comparableOperationCount }` from Task 1.
- Produces: `SlowOperationsResult` TS interface; `getSlowOperations(...)` now resolves to it.

- [ ] **Step 1: Write the failing tests**

Rewrite the mock in `frontend/src/pages/AnalysisPage.test.tsx` to carry the counts, import `getSlowOperations`, and add three empty-state tests. Replace lines 1-21 (imports + `vi.mock`) with:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getSlowOperations } from '../api/stats'
import { AnalysisPage } from './AnalysisPage'

const SLOW_OP = { template: 'Report query {Query} took {Elapsed} ms', baselineP95: 70, currentP95: 606, count: 88 }
const ONE_HOUR_MS = 60 * 60 * 1000

// mirrors the server: `from` splits baseline from current, so an operation whose history is
// younger than the selected range has no baseline and only regresses on a recent `from`
vi.mock('../api/stats', () => ({
  getTopErrors: vi.fn(async () => ({ errors: [] })),
  getTopExceptions: vi.fn(async () => ({ exceptions: [] })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getSlowOperations: vi.fn(async ({ from }: { from: string }) =>
    Date.now() - new Date(from).getTime() <= ONE_HOUR_MS
      ? { operations: [SLOW_OP], timedOperationCount: 1, comparableOperationCount: 1 }
      : { operations: [], timedOperationCount: 0, comparableOperationCount: 0 },
  ),
}))
```

Then append these three tests at the end of the file (after the existing preset test):

```tsx
it('explains an empty card: no operation reports a duration', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue({ operations: [], timedOperationCount: 0, comparableOperationCount: 0 })
  renderPage()

  expect(await screen.findByText(/No operation reports an/)).toBeDefined()
})

it('explains an empty card: no baseline history to compare against', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue({ operations: [], timedOperationCount: 3, comparableOperationCount: 0 })
  renderPage()

  expect(await screen.findByText(/No operation has enough history/)).toBeDefined()
})

it('explains an empty card: comparable but nothing regressed', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue({ operations: [], timedOperationCount: 3, comparableOperationCount: 3 })
  renderPage()

  expect(await screen.findByText('No operations are slower than usual.')).toBeDefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- AnalysisPage`
Expected: FAIL — the three new tests can't find the new copy (`No operation reports an…`, `No operation has enough history…`, `No operations are slower than usual.`); the card still renders `noSlowOpsBefore`/`noSlowOpsAfter`. (TypeScript may also flag the mock shape until Step 4.)

- [ ] **Step 3: Add the `SlowOperationsResult` type and widen the API return**

In `frontend/src/types/index.ts`, after the `SlowOperation` interface (line 81):

```ts
/** GET /api/stats/slow-operations response: the regressed groups plus why the list may be empty. */
export interface SlowOperationsResult {
  operations: SlowOperation[]
  timedOperationCount: number
  comparableOperationCount: number
}
```

In `frontend/src/api/stats.ts`, add `SlowOperationsResult` to the type import on line 2:

```ts
import type { HeatmapCell, Histogram, ServiceOverview, SlowOperation, SlowOperationsResult, StatsSummary, TopError, TopException } from '../types'
```

and replace `getSlowOperations` (lines 42-46):

```ts
export function getSlowOperations(
  params: StatsRangeParams & { property?: string; minSamples?: number; floorMs?: number; factor?: number; limit?: number },
): Promise<SlowOperationsResult> {
  return api.get<SlowOperationsResult>(`/api/stats/slow-operations${buildQuery(params)}`)
}
```

(`SlowOperation` is still imported — it's referenced by `SlowOperationsResult`'s field type and elsewhere.)

- [ ] **Step 4: Replace the i18n keys**

In `frontend/src/i18n/en.ts`, replace lines 180-181 (`noSlowOpsBefore`/`noSlowOpsAfter`):

```ts
    noTimedOpsBefore: 'No operation reports an ',
    noTimedOpsAfter: ' duration in this range.',
    noBaselineToCompare: 'No operation has enough history before the selected range to compare against. Try a narrower range.',
    noSlowOps: 'No operations are slower than usual.',
```

In `frontend/src/i18n/tr.ts`, replace lines 182-183:

```ts
    noTimedOpsBefore: 'Bu aralıkta hiçbir işlem ',
    noTimedOpsAfter: ' süresi bildirmiyor.',
    noBaselineToCompare: 'Seçilen aralıktan önce karşılaştırılacak yeterli geçmişi olan işlem yok. Daha dar bir aralık deneyin.',
    noSlowOps: 'Normalden yavaş işlem yok.',
```

- [ ] **Step 5: Render the four states and add slow.error to the banner**

In `frontend/src/pages/AnalysisPage.tsx`, add a property constant after `BASELINE_START` (line 17):

```ts
// the frontend never overrides the endpoint's `property` default, so the timed message names it
const SLOW_PROPERTY = 'Elapsed'
```

Change `queryError` (line 59) to include the slow query:

```ts
  const queryError = errors.error ?? exceptions.error ?? slow.error
```

Replace the empty-state block (lines 203-209) with the four-state render:

```tsx
          {slow.data && slow.data.operations.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">
              {slow.data.timedOperationCount === 0 ? (
                <>
                  {t.analysis.noTimedOpsBefore}
                  <span className="font-mono">{SLOW_PROPERTY}</span>
                  {t.analysis.noTimedOpsAfter}
                </>
              ) : slow.data.comparableOperationCount === 0 ? (
                t.analysis.noBaselineToCompare
              ) : (
                t.analysis.noSlowOps
              )}
            </p>
          )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- AnalysisPage`
Expected: PASS — all four tests (the existing preset test + three empty-state tests).

Then run the full frontend suite and the typecheck/build:
Run: `cd frontend && npm run test`
Expected: PASS (all green).
Run: `cd frontend && npm run build`
Expected: clean `tsc` + `vite build`, no type errors (proves no dangling reference to the removed `noSlowOps*` keys).

- [ ] **Step 7: Update docs/frontend.md**

In `docs/frontend.md`, replace the "Empty when…" sentence (lines 144-145) so it describes the three empty states:

```
  usual p95, now p95, x slower, count and a template-filtered sparkline. When the list is
  empty the card reads timedOperationCount/comparableOperationCount from the response to say
  which case it is: no event carries an Elapsed duration, no group has baseline history
  before the range to compare against (narrow the range), or nothing regressed.
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/stats.ts frontend/src/i18n/en.ts frontend/src/i18n/tr.ts frontend/src/pages/AnalysisPage.tsx frontend/src/pages/AnalysisPage.test.tsx docs/frontend.md
git commit -m "feat(analysis): four-state empty message on the slow-operations card"
```

---

## Notes for the implementer

- The two-statement command relies on `SqliteDataReader.NextResultAsync()` advancing to the second `SELECT`; Microsoft.Data.Sqlite supports multiple `;`-separated statements in one `CommandText`. All parameters are added once and shared by both statements.
- `SlowOperationsResult` returned by the endpoint via `Results.Ok(result)` serializes to camelCase automatically — do not build an anonymous wrapper.
- Vitest runs a file's tests in order; the three empty-state tests override `getSlowOperations` with `mockResolvedValue`, the earlier preset test relies on the date-dependent factory default. Keep the preset test first (same pattern as `TracePanel.test.tsx`).
- Out of scope (per the design): changing baseline semantics or the split, a p95 latency alert, the `DurationMs`/`Elapsed` naming mismatch in `seed-demo`, and stale `wwwroot` build output.
