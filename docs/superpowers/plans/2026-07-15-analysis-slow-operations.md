# Analysis "Slower than usual" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Slower than usual" section to the Analysis page that automatically lists operation groups whose latency in the selected range is materially worse than that group's own historical baseline — no user threshold.

**Architecture:** A new `GET /api/stats/slow-operations` computes, per `message_template`, a baseline p95 (history before the range) and a current p95 (in range) of a numeric duration property (default `Elapsed`), and returns groups where `currentP95 >= factor × baselineP95` with sample/floor guardrails. The Analysis page renders it as a third table, reusing the existing time range, `Card`, and (generalised) `Sparkline`. Backend-first, TDD.

**Tech Stack:** .NET 8 / ASP.NET minimal API / SQLite (window functions), xUnit; React 19 / TS / Vite / Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-15-analysis-slow-operations-design.md`. Read before Task 1.
- **Duration property** defaults to `Elapsed`; overridable via a `property` query param validated to `[A-Za-z0-9_]` (same rule as `PropertyValuesAsync`). No Settings UI in v1.
- **Guardrails are internal calibration, not user thresholds**, exposed as query params with defaults: `minSamples=20`, `floorMs=50`, `factor=2.0`.
- **"Normal" = the group's own baseline p95**; baseline window is `[2000-01-01T00:00:00Z, from)`, current is `[from, to)`.
- **p95 via `ROW_NUMBER`, not `PERCENT_RANK`** — equal-value bursts must survive (see spec).
- **No git push.** Commit locally only if asked; the steps below hold regardless.
- **Verify:** `dotnet test backend` for Task 1; `npm run lint && npm run build && npm run test` for Task 2.

---

### Task 1: Backend — `/api/stats/slow-operations` (TDD)

**Files:**
- Modify: `backend/LogHarbor.Core/Storage/IEventStore.cs` (record + method)
- Modify: `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` (implementation)
- Modify: `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs` (route + handler)
- Test: `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs`
- Modify: `docs/api.md` (document the endpoint)

**Interfaces:**
- Consumes: `BuildStatsSourceAsync`, `QuerySql`, `ClefParser.FormatTimestamp`, `TryValidateCommon` (all existing).
- Produces:
  - `public record SlowOperation(string Template, double BaselineP95, double CurrentP95, long Count);`
  - `Task<IReadOnlyList<SlowOperation>> IEventStore.GetSlowOperationsAsync(QuerySql? filter, string baselineFromUtc, string splitUtc, string toUtc, string property, int minSamples, double floorMs, double factor, int limit, CancellationToken ct = default)`
  - `GET /api/stats/slow-operations` → `{ operations: SlowOperation[] }`.

- [ ] **Step 1: Write the failing test**

In `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs`, add a `Timed` helper next to `SeedAnalysis` and two tests. `Timed` writes an event carrying an `Elapsed` property:

```csharp
    private static Event Timed(string timestamp, string template, int elapsedMs) =>
        new(0, timestamp, "Information", "msg", template, $$"""{"Elapsed":{{elapsedMs}}}""", null, timestamp);
```

```csharp
    [Fact]
    public async Task SlowOperations_FlagsGroupsSlowerThanTheirBaseline()
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        var batch = new List<Event>();
        // "Handle {Path}": baseline ~40ms (before range), current ~5000ms (in range) => regression
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Handle {Path}", 40 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Handle {Path}", 5000 + i));
        // "Burst {Path}": current all EXACTLY 8000ms (identical) => must still flag (ROW_NUMBER, not PERCENT_RANK)
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Burst {Path}", 50 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Burst {Path}", 8000));
        // "Fast {Path}": ~5ms, below floor => never flagged
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Fast {Path}", 4 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Fast {Path}", 6 + i));
        // "Steady {Path}": ~1000ms in both windows => no regression
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T09:00:00.0000000Z", "Steady {Path}", 1000 + i));
        for (var i = 0; i < 5; i++) batch.Add(Timed("2026-07-16T10:10:00.0000000Z", "Steady {Path}", 1000 + i));
        await store.WriteBatchAsync(batch);

        var response = await _client.GetAsync(
            "/api/stats/slow-operations?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z&minSamples=3&floorMs=10&factor=2");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ops = body.GetProperty("operations").EnumerateArray().ToList();
        var templates = ops.Select(o => o.GetProperty("template").GetString()).ToHashSet();
        Assert.Equal(new HashSet<string?> { "Handle {Path}", "Burst {Path}" }, templates);
        var handle = ops.Single(o => o.GetProperty("template").GetString() == "Handle {Path}");
        Assert.Equal(5, handle.GetProperty("count").GetInt64());
        Assert.True(handle.GetProperty("currentP95").GetDouble() >= handle.GetProperty("baselineP95").GetDouble() * 2);
    }

    [Theory]
    [InlineData("/api/stats/slow-operations?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z&property=bad%27name")]
    [InlineData("/api/stats/slow-operations?from=2026-07-16T10:00:00Z&to=2026-07-16T11:00:00Z&factor=0.5")]
    [InlineData("/api/stats/slow-operations?from=not-a-date&to=2026-07-16T11:00:00Z")]
    public async Task SlowOperations_InvalidInput_Returns400(string url)
    {
        var response = await _client.GetAsync(url);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
dotnet test backend --filter "FullyQualifiedName~SlowOperations"
```

Expected: FAIL — route missing (404, so the OK/400 assertions fail).

- [ ] **Step 3: Add the record and interface method**

In `backend/LogHarbor.Core/Storage/IEventStore.cs`, next to the other stat records (`TopError`, `TopException`, `PropertyValueCount`) add:

```csharp
public record SlowOperation(string Template, double BaselineP95, double CurrentP95, long Count);
```

and on the `IEventStore` interface, next to `GetTopErrorsAsync`:

```csharp
    Task<IReadOnlyList<SlowOperation>> GetSlowOperationsAsync(
        QuerySql? filter, string baselineFromUtc, string splitUtc, string toUtc,
        string property, int minSamples, double floorMs, double factor, int limit,
        CancellationToken cancellationToken = default);
```

- [ ] **Step 4: Implement it in `SqliteEventStore`**

In `backend/LogHarbor.Core/Storage/SqliteEventStore.cs`, after `GetTopErrorsAsync`, add:

```csharp
    public async Task<IReadOnlyList<SlowOperation>> GetSlowOperationsAsync(
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

        // safe to embed: property is restricted to [A-Za-z0-9_] at the API boundary
        var extract = $"json_extract(properties, '$.{property}')";
        command.CommandText =
            "WITH v AS (" +
            $"SELECT message_template AS tmpl, CAST({extract} AS REAL) AS ms, " +
            "CASE WHEN timestamp < @split THEN 0 ELSE 1 END AS cur " +
            $"FROM {source} WHERE message_template IS NOT NULL AND {extract} IS NOT NULL), " +
            // ROW_NUMBER (not PERCENT_RANK) so a burst of equal durations doesn't collapse to rank 0
            "r AS (SELECT tmpl, cur, ms, " +
            "ROW_NUMBER() OVER (PARTITION BY tmpl, cur ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY tmpl, cur) AS n FROM v), " +
            "p AS (SELECT tmpl, cur, MAX(n) AS n, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 " +
            "FROM r GROUP BY tmpl, cur) " +
            "SELECT b.tmpl, b.p95 AS base_p95, c.p95 AS cur_p95, c.n AS cur_n " +
            "FROM p b JOIN p c ON c.tmpl = b.tmpl AND b.cur = 0 AND c.cur = 1 " +
            "WHERE b.n >= @minSamples AND c.n >= @minSamples AND b.p95 >= @floorMs AND b.p95 > 0 " +
            "AND c.p95 >= b.p95 * @factor " +
            "ORDER BY c.p95 / b.p95 DESC, c.p95 DESC LIMIT @limit;";
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
        return rows;
    }
```

- [ ] **Step 5: Add the route and handler in `StatsEndpoints`**

In `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs`, register the route in `MapStats` (after `top-exceptions`):

```csharp
        group.MapGet("/slow-operations", SlowOperationsAsync);
```

Add the baseline constant near `DefaultErrorLevels`:

```csharp
    // events before this predate the server; used as the open-ended baseline start
    private const string BaselineStart = "2000-01-01T00:00:00.0000000Z";
```

And the handler (mirrors `TopErrorsAsync` + `PropertyValuesAsync` validation):

```csharp
    private static async Task<IResult> SlowOperationsAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string property = "Elapsed",
        int minSamples = 20,
        double floorMs = 50,
        double factor = 2.0,
        int limit = 20)
    {
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_'))
        {
            return BadRequest("Invalid query", "property must contain only letters, digits, or underscores.");
        }
        if (minSamples < 1 || floorMs < 0 || factor < 1)
        {
            return BadRequest("Invalid query", "minSamples>=1, floorMs>=0 and factor>=1 are required.");
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var operations = await eventStore.GetSlowOperationsAsync(
            filterSql, BaselineStart, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, minSamples, floorMs, factor, limit, cancellationToken);
        return Results.Ok(new { operations });
    }
```

- [ ] **Step 6: Run tests, verify green**

```bash
dotnet test backend --filter "FullyQualifiedName~SlowOperations"
dotnet test backend
```

Expected: the two new tests pass and the whole backend suite stays green. If `FILTER (WHERE ...)` throws a syntax error, the bundled SQLite predates 3.30 — stop and report (the spec assumes ≥ 3.30).

- [ ] **Step 7: Document the endpoint**

In `docs/api.md`, under the stats section, add a line for `GET /api/stats/slow-operations` describing params (`from`, `to`, `filter?`, `property?=Elapsed`, `minSamples?=20`, `floorMs?=50`, `factor?=2.0`, `limit?=20`) and the `{ operations: [{ template, baselineP95, currentP95, count }] }` shape, plus the one-sentence "each group compared to its own baseline p95" rule.

- [ ] **Step 8: Commit**

```bash
git add backend/LogHarbor.Core/Storage/IEventStore.cs backend/LogHarbor.Core/Storage/SqliteEventStore.cs backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs docs/api.md
git commit -m "feat(stats): slow-operations endpoint (per-group latency regression)"
```

---

### Task 2: Frontend — "Slower than usual" section on Analysis

**Files:**
- Modify: `frontend/src/types.ts` (add `SlowOperation`)
- Modify: `frontend/src/api/stats.ts` (add `getSlowOperations`)
- Modify: `frontend/src/hooks/useStats.ts` (add `useSlowOperations`)
- Modify: `frontend/src/pages/AnalysisPage.tsx` (generalise `Sparkline`, add the section)
- Modify: `docs/frontend.md` (describe the section)

**Interfaces:**
- Consumes: the Task 1 endpoint; `useHistogram`, `Card`, `LEVEL_HEX`, `TimeRangePicker`, `formatTimestamp` (existing).
- Produces: `SlowOperation` type, `getSlowOperations`, `useSlowOperations`.

- [ ] **Step 1: Add the type**

In `frontend/src/types.ts`, add next to `TopError`:

```ts
export interface SlowOperation {
  template: string
  baselineP95: number
  currentP95: number
  count: number
}
```

- [ ] **Step 2: Add the API client function**

In `frontend/src/api/stats.ts`, add the import and function:

```ts
import type { HeatmapCell, Histogram, SlowOperation, StatsSummary, TopError, TopException } from '../types'
```

```ts
export function getSlowOperations(
  params: StatsRangeParams & { property?: string; minSamples?: number; floorMs?: number; factor?: number; limit?: number },
): Promise<{ operations: SlowOperation[] }> {
  return api.get<{ operations: SlowOperation[] }>(`/api/stats/slow-operations${buildQuery(params)}`)
}
```

- [ ] **Step 3: Add the hook**

In `frontend/src/hooks/useStats.ts`, extend the stats import and add:

```ts
import { getHeatmap, getHistogram, getSlowOperations, getSummary, getTopErrors, getTopExceptions } from '../api/stats'
```

```ts
export function useSlowOperations(params: StatsRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'slow-operations', params],
    queryFn: () => getSlowOperations(params),
    ...KEEP_PREVIOUS,
  })
}
```

- [ ] **Step 4: Generalise `Sparkline` to take a filter**

In `frontend/src/pages/AnalysisPage.tsx`, change `Sparkline` from taking a `row` to taking a `filter` + `color` so both sections can use it:

```tsx
function Sparkline({ filter, color, from, to }: { filter: string; color: string; from: string; to: string }) {
  const histogram = useHistogram({ from, to, filter, buckets: SPARKLINE_BUCKETS })
  const totals = (histogram.data?.buckets ?? []).map((bucket) =>
    LEVELS.reduce((total, level) => total + bucket.counts[level], 0),
  )
  const max = Math.max(1, ...totals)

  return (
    <div className="flex h-5 w-24 items-end gap-px" aria-hidden="true">
      {totals.map((total, index) => (
        <span
          key={index}
          className="min-w-0 flex-1 rounded-t-[1px]"
          style={{ height: total > 0 ? `${Math.max(8, (total / max) * 100)}%` : '0%', backgroundColor: color }}
        />
      ))}
    </div>
  )
}
```

Update the existing Top-errors caller (in the errors table) to the new props:

```tsx
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@Level = '${row.level}' and @MessageTemplate = ${quote(row.template)}`}
                      color={LEVEL_HEX[row.level]}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
```

- [ ] **Step 5: Add the "Slower than usual" section**

Still in `AnalysisPage.tsx`: extend the stats import, add the hook call, a `formatMs` helper, and the section. Import:

```tsx
import { useHistogram, useSlowOperations, useTopErrors, useTopExceptions } from '../hooks/useStats'
```

Inside `AnalysisPage`, next to the other hook calls:

```tsx
  const slow = useSlowOperations({ ...range, limit: ROW_LIMIT })
```

Add near the top-level helpers (outside the component):

```tsx
function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
```

Then add this `<section>` after the Top exceptions section:

```tsx
      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">Slower than usual</h2>
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={TH_CLASS}>Operation</th>
                <th className={`${TH_CLASS} text-right`}>Usual p95</th>
                <th className={`${TH_CLASS} text-right`}>Now p95</th>
                <th className={`${TH_CLASS} text-right`}>× slower</th>
                <th className={`${TH_CLASS} text-right`}>Count</th>
                <th className={TH_CLASS}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {(slow.data?.operations ?? []).map((op) => (
                <tr
                  key={op.template}
                  onClick={() =>
                    navigate(
                      `/?${new URLSearchParams({ from: range.from, to: range.to, filter: `@MessageTemplate = ${quote(op.template)}` }).toString()}`,
                    )
                  }
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{op.template}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatMs(op.baselineP95)}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatMs(op.currentP95)}</td>
                  <td className={`${TD_CLASS} tabular text-right font-medium text-level-warning`}>
                    {(op.currentP95 / op.baselineP95).toFixed(1)}×
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{op.count}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@MessageTemplate = ${quote(op.template)}`}
                      color={LEVEL_HEX.Warning}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {slow.data?.operations.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">
              No operations are slower than usual. (Needs an <span className="font-mono">Elapsed</span> duration property on your events.)
            </p>
          )}
        </Card>
      </section>
```

Note: one informative empty state is used instead of the two the spec described — this avoids a second "is there any timed data?" request while still telling a user who never sends `Elapsed` why the list is empty. `// ponytail: one honest empty state beats a second round-trip.`

- [ ] **Step 6: Verify**

```bash
cd frontend
npm run lint && npm run build && npm run test
```

Expected: all pass. A type error about `Sparkline` props means a caller still passes `row` — fix it to `filter`/`color`.

- [ ] **Step 7: Document the section**

In `docs/frontend.md`, under the Analysis page description, add a short paragraph: the "Slower than usual" table lists operation groups whose current p95 is at least `factor`× their historical baseline p95 of the `Elapsed` property, ranked by the regression; row click deep-links to those events.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/stats.ts frontend/src/hooks/useStats.ts frontend/src/pages/AnalysisPage.tsx docs/frontend.md
git commit -m "feat(analysis): 'slower than usual' latency-regression section"
```

---

## Notes for the implementer

- The one subtle bit is the SQL: `ROW_NUMBER` + `MIN(ms) FILTER (WHERE rn >= 0.95 * n)` is a nearest-rank p95 that survives equal-value bursts; the `Burst {Path}` test guards exactly that. Don't swap it back to `PERCENT_RANK`.
- `Elapsed` is a convention, not a schema column — everything keys off `json_extract(properties, '$.Elapsed')`. Events without it are simply excluded.
- Reuse `BuildStatsSourceAsync` with the wide `[baseline, to)` window and split in SQL; do not add a second query for the baseline.
- Keep the guardrail defaults out of the UI; they are query params for tests/tuning only.
```
