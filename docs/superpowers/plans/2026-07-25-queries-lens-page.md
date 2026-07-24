# Queries Lens Page (Split Master-Detail) & Nav Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/queries` page — Nightwatch-style DB query stats (Calls / Total / AVG / P95) in a 50/50 master-detail split with a rich right-hand detail pane — plus small line icons on every top-nav link, then deploy the development build to the test server.

**Architecture:** One new read-only endpoint `GET /api/stats/queries` backed by a new `GetQueryOverviewAsync` store method (property-grouping from user-activity + the ROW_NUMBER p95 CTE from operations). The page keeps the classic top-nav design; the split layout is page-internal. Icons are hand-rolled inline SVGs in one component.

**Tech Stack:** .NET 8 minimal API + SQLite JSON1 (backend), React 18 + TS strict + Tailwind + React Query (frontend), xUnit + Vitest. Spec: `docs/superpowers/specs/2026-07-25-queries-lens-page-design.md`.

## Global Constraints

- Work on the **`development`** branch; never commit to `main`.
- English code/comments/commits (`rules.md`); commit bodies end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Backend: nullable + warnings-as-errors; storage behind `IEventStore`; parameterized SQL only — property names may be embedded ONLY after the `[A-Za-z0-9_.]` validation used by user-activity; DTOs are records; ProblemDetails for errors.
- Frontend: TS strict, no `any`; API calls only via `src/api/`; Tailwind only; React Query for server state; i18n keys in BOTH `en.ts` (source) and `tr.ts` (typed mirror — missing key = compile error).
- No icon library, no chart library — inline SVG only, existing tokens (`text-fg`, `text-fg-muted`, `bg-surface*`, `border-border`, `LEVEL_HEX`), both themes.
- EF Core defaults everywhere: query property `commandText`, duration property `elapsed`, connection property `connection` (all lowercase-camel).
- Commands: backend tests `dotnet test backend` (repo root); frontend (in `frontend/`) `npm run test` / one file `npm run test -- src/pages/QueriesPage.test.tsx` / build `npm run build`.
- Test seeds in `StatsEndpointsTests` must use a UTC day no other test uses — this plan uses **2026-07-18**.

---

### Task 1: Backend — QueryOverview store method + /api/stats/queries

**Files:**
- Modify: `backend/LogHarbor.Core/Storage/IEventStore.cs` (record near line 43, method after `GetUserActivityAsync` ~line 123)
- Modify: `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` (new method after `GetUserActivityAsync`, ~line 513)
- Modify: `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs` (map + handler)
- Test: `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs`

**Interfaces:**
- Consumes: `BuildStatsSourceAsync(connection, command, filter, "level, properties, timestamp", fromUtc, toUtc, ct)`, `TryValidateCommon`, `BadRequest`, `ClefParser.FormatTimestamp` — all already in those files.
- Produces: `record QueryOverview(string Value, string? Connection, long Calls, long ErrorCount, double? TotalMs, double? AvgMs, double? P95Ms, string LastSeen)`; `Task<IReadOnlyList<QueryOverview>> GetQueryOverviewAsync(QuerySql? filter, string fromUtc, string toUtc, string property, string durationProperty, string connectionProperty, int limit, CancellationToken ct = default)`; HTTP `GET /api/stats/queries?from&to&filter?&property=commandText&durationProperty=elapsed&connectionProperty=connection&limit=50` → `{ "queries": [{ value, connection, calls, errorCount, totalMs, avgMs, p95Ms, lastSeen }] }`.

- [ ] **Step 1: Write the failing endpoint tests**

Add to `backend/LogHarbor.Tests/Api/StatsEndpointsTests.cs`:

```csharp
    [Fact]
    public async Task Queries_GroupsBySqlText_WithDurations()
    {
        // 2026-07-18: a day the shared seeds never touch
        var store = _factory.Services.GetRequiredService<IEventStore>();
        await store.WriteBatchAsync(
        [
            new Event(0, "2026-07-18T10:00:00.0000000Z", "Information", "q", null,
                """{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":10,"connection":"main"}""",
                null, "2026-07-18T10:00:00.0000000Z"),
            new Event(0, "2026-07-18T10:01:00.0000000Z", "Error", "q", null,
                """{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":100,"connection":"main"}""",
                null, "2026-07-18T10:01:00.0000000Z"),
            new Event(0, "2026-07-18T10:02:00.0000000Z", "Information", "q", null,
                """{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":20,"connection":"main"}""",
                null, "2026-07-18T10:02:00.0000000Z"),
            // a query that never reports a duration or connection
            new Event(0, "2026-07-18T10:03:00.0000000Z", "Information", "q", null,
                """{"commandText":"PRAGMA user_version"}""", null, "2026-07-18T10:03:00.0000000Z"),
            // no commandText -> excluded entirely
            new Event(0, "2026-07-18T10:04:00.0000000Z", "Information", "q", null,
                """{"elapsed":999}""", null, "2026-07-18T10:04:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/stats/queries?from=2026-07-18T10:00:00Z&to=2026-07-18T11:00:00Z");

        var rows = page.GetProperty("queries").EnumerateArray().ToList();
        Assert.Equal(2, rows.Count);

        // timed group first (ordered by total time)
        var timed = rows[0];
        Assert.Equal("SELECT * FROM orders WHERE id = @p0", timed.GetProperty("value").GetString());
        Assert.Equal("main", timed.GetProperty("connection").GetString());
        Assert.Equal(3, timed.GetProperty("calls").GetInt64());
        Assert.Equal(1, timed.GetProperty("errorCount").GetInt64());
        Assert.Equal(130, timed.GetProperty("totalMs").GetDouble());
        Assert.Equal(130.0 / 3, timed.GetProperty("avgMs").GetDouble(), precision: 5);
        Assert.Equal(100, timed.GetProperty("p95Ms").GetDouble());
        Assert.Equal("2026-07-18T10:02:00.0000000Z", timed.GetProperty("lastSeen").GetString());

        var untimed = rows[1];
        Assert.Equal("PRAGMA user_version", untimed.GetProperty("value").GetString());
        Assert.Equal(JsonValueKind.Null, untimed.GetProperty("connection").ValueKind);
        Assert.Equal(1, untimed.GetProperty("calls").GetInt64());
        Assert.Equal(JsonValueKind.Null, untimed.GetProperty("totalMs").ValueKind);
        Assert.Equal(JsonValueKind.Null, untimed.GetProperty("p95Ms").ValueKind);
    }

    [Fact]
    public async Task Queries_RejectsInvalidPropertyName()
    {
        var response = await _client.GetAsync(
            "/api/stats/queries?from=2026-07-18T10:00:00Z&to=2026-07-18T11:00:00Z&property=bad;name");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~Queries_" --nologo -v q`
Expected: FAIL — 404 from the unmapped route (`GetFromJsonAsync` throws on 404).

- [ ] **Step 3: Add the record and interface method**

`backend/LogHarbor.Core/Storage/IEventStore.cs` — after the `UserActivity` record (line 43):

```csharp
/// <summary>One DB-query group: events sharing a query-text property value.</summary>
public sealed record QueryOverview(
    string Value, string? Connection, long Calls, long ErrorCount,
    double? TotalMs, double? AvgMs, double? P95Ms, string LastSeen);
```

After `GetUserActivityAsync` (line 123):

```csharp
    /// <summary>
    /// Per-query stats grouped by one query-text <paramref name="property"/> (calls, Error+Fatal
    /// count, total/avg/p95 of <paramref name="durationProperty"/>, connection, last-seen),
    /// most total time first. Events without the property are excluded. All three property names
    /// must be bare identifiers ([A-Za-z0-9_.]); the API boundary validates them. Searches hot +
    /// hydrated data.
    /// </summary>
    Task<IReadOnlyList<QueryOverview>> GetQueryOverviewAsync(
        QuerySql? filter, string fromUtc, string toUtc,
        string property, string durationProperty, string connectionProperty, int limit,
        CancellationToken cancellationToken = default);
```

- [ ] **Step 4: Implement the store method**

`backend/LogHarbor.Core/Storage/SqliteEventStore.cs`, after `GetUserActivityAsync` (line 513):

```csharp
    public async Task<IReadOnlyList<QueryOverview>> GetQueryOverviewAsync(
        QuerySql? filter, string fromUtc, string toUtc,
        string property, string durationProperty, string connectionProperty, int limit,
        CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        var source = await BuildStatsSourceAsync(
            connection, command, filter, "level, properties, timestamp", fromUtc, toUtc, cancellationToken);

        // safe to embed: all three property names are restricted to [A-Za-z0-9_.] at the API
        // boundary; the quoted step keeps dots literal. p95 mirrors GetOperationOverviewAsync.
        command.CommandText =
            "WITH q AS (" +
            $"SELECT CAST(json_extract(properties, '$.\"{property}\"') AS TEXT) AS qry, " +
            $"CAST(json_extract(properties, '$.\"{durationProperty}\"') AS REAL) AS ms, " +
            $"CAST(json_extract(properties, '$.\"{connectionProperty}\"') AS TEXT) AS conn, " +
            "level, timestamp " +
            $"FROM {source}), " +
            "g AS (SELECT * FROM q WHERE qry IS NOT NULL), " +
            "s AS (SELECT qry, COUNT(*) AS calls, " +
            "SUM(CASE WHEN level IN ('Error', 'Fatal') THEN 1 ELSE 0 END) AS errors, " +
            "SUM(ms) AS total_ms, AVG(ms) AS avg_ms, MAX(conn) AS conn, MAX(timestamp) AS last_seen " +
            "FROM g GROUP BY qry), " +
            "r AS (SELECT qry, ms, ROW_NUMBER() OVER (PARTITION BY qry ORDER BY ms) AS rn, " +
            "COUNT(*) OVER (PARTITION BY qry) AS n FROM g WHERE ms IS NOT NULL), " +
            "p AS (SELECT qry, MIN(ms) FILTER (WHERE rn >= 0.95 * n) AS p95 FROM r GROUP BY qry) " +
            "SELECT s.qry, s.conn, s.calls, s.errors, s.total_ms, s.avg_ms, p.p95, s.last_seen " +
            "FROM s LEFT JOIN p ON p.qry = s.qry " +
            "ORDER BY (s.total_ms IS NULL), s.total_ms DESC, s.calls DESC, s.qry LIMIT @limit;";
        command.Parameters.AddWithValue("@limit", limit);

        var rows = new List<QueryOverview>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new QueryOverview(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetInt64(2), reader.GetInt64(3),
                reader.IsDBNull(4) ? null : reader.GetDouble(4),
                reader.IsDBNull(5) ? null : reader.GetDouble(5),
                reader.IsDBNull(6) ? null : reader.GetDouble(6),
                reader.GetString(7)));
        }
        return rows;
    }
```

- [ ] **Step 5: Map and implement the endpoint**

`backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs` — after `group.MapGet("/user-activity", UserActivityAsync);` add `group.MapGet("/queries", QueriesAsync);`, and after the `UserActivityAsync` handler add:

```csharp
    private static async Task<IResult> QueriesAsync(
        IEventStore eventStore,
        CancellationToken cancellationToken,
        string from,
        string to,
        string? filter = null,
        string property = "commandText",
        string durationProperty = "elapsed",
        string connectionProperty = "connection",
        int limit = 50)
    {
        // same alphabet as query-language identifiers; anything else could escape the JSON path
        foreach (var name in new[] { property, durationProperty, connectionProperty })
        {
            if (name.Length == 0 || !name.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
            {
                return BadRequest("Invalid query", "property names must contain only letters, digits, underscores, or dots.");
            }
        }
        if (!TryValidateCommon(from, to, filter, limit, out var fromValue, out var toValue, out var filterSql, out var error))
        {
            return error!;
        }

        var queries = await eventStore.GetQueryOverviewAsync(
            filterSql, ClefParser.FormatTimestamp(fromValue), ClefParser.FormatTimestamp(toValue),
            property, durationProperty, connectionProperty, limit, cancellationToken);
        return Results.Ok(new { queries });
    }
```

- [ ] **Step 6: Run the new tests, then the whole backend suite**

Run: `dotnet test backend --filter "FullyQualifiedName~Queries_" --nologo -v q` → PASS (2)
Run: `dotnet test backend --nologo -v q` → all pass (377 + 2).

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(stats): /api/stats/queries groups DB-query events with durations"
```

---

### Task 2: PageIcon component + icons in the top nav

**Files:**
- Create: `frontend/src/components/icons.tsx`
- Modify: `frontend/src/components/NavBar.tsx`
- Test: `frontend/src/components/NavBar.test.tsx`

**Interfaces:**
- Produces: `export type PageIconName = 'dashboard' | 'events' | 'requests' | 'exceptions' | 'queries' | 'services' | 'users' | 'analysis' | 'signals' | 'alerts' | 'settings'`; `export function PageIcon({ name, className }: { name: PageIconName; className?: string })` — 24-viewBox stroke SVG, defaults to `size-4`. Tasks 3–4 put it in the Queries page header; the nav link for `/queries` is added in Task 3 (with the route, so no dead link).

- [ ] **Step 1: Extend the NavBar test (fails first)**

Add to `frontend/src/components/NavBar.test.tsx`:

```tsx
it('renders an icon inside every nav link', () => {
  renderNav()
  for (const link of screen.getAllByRole('link')) {
    expect(link.querySelector('svg')).not.toBeNull()
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/components/NavBar.test.tsx`
Expected: FAIL — links contain no `<svg>`.

- [ ] **Step 3: Create the icon component**

Create `frontend/src/components/icons.tsx`:

```tsx
import type { ReactNode } from 'react'

export type PageIconName =
  | 'dashboard'
  | 'events'
  | 'requests'
  | 'exceptions'
  | 'queries'
  | 'services'
  | 'users'
  | 'analysis'
  | 'signals'
  | 'alerts'
  | 'settings'

// hand-rolled lucide-style outlines; 24 viewBox, stroke inherits text color
const PATHS: Record<PageIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  events: <path d="M4 6h16M4 12h16M4 18h10" />,
  requests: <path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />,
  exceptions: <path d="M12 3 2 21h20L12 3zM12 10v5M12 18.5v.01" />,
  queries: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  services: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.4c2.1.8 3.5 2.9 3.5 5.6" />
    </>
  ),
  analysis: <path d="M5 21v-8M12 21V4M19 21v-6" />,
  signals: <path d="M6 3h12v18l-6-4.5L6 21V3z" />,
  alerts: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="7" cy="17" r="2" />
    </>
  ),
}

/** Small line icon for a nav destination; decorative (aria-hidden), colored by the text around it. */
export function PageIcon({ name, className = 'size-4' }: { name: PageIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
```

- [ ] **Step 4: Put icons in the NavBar**

In `frontend/src/components/NavBar.tsx`:
- Add `import { PageIcon } from './icons'` and `import type { PageIconName } from './icons'`.
- Give every entry in `links` an `icon` field:

```tsx
  const links: { to: string; label: string; end: boolean; icon: PageIconName }[] = [
    { to: '/', label: t.nav.dashboard, end: true, icon: 'dashboard' },
    { to: '/events', label: t.nav.events, end: false, icon: 'events' },
    { to: '/requests', label: t.nav.requests, end: false, icon: 'requests' },
    { to: '/exceptions', label: t.nav.exceptions, end: false, icon: 'exceptions' },
    { to: '/services', label: t.nav.services, end: false, icon: 'services' },
    { to: '/users', label: t.nav.users, end: false, icon: 'users' },
    { to: '/analysis', label: t.nav.analysis, end: false, icon: 'analysis' },
    { to: '/signals', label: t.nav.signals, end: false, icon: 'signals' },
    { to: '/alerts', label: t.nav.alerts, end: false, icon: 'alerts' },
    { to: '/settings', label: t.nav.settings, end: false, icon: 'settings' },
  ]
```

- Render icon + label (add flex classes to the NavLink class string):

```tsx
      {links.map(({ to, label, end, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'bg-surface-raised text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            }`
          }
        >
          <PageIcon name={icon} />
          {label}
        </NavLink>
      ))}
```

- [ ] **Step 5: Run the NavBar tests, then the full suite**

Run: `npm run test -- src/components/NavBar.test.tsx` → PASS (3: order, icons, language).
Run: `npm run test` → all pass (the order test's `textContent` comparison is unaffected — SVGs contribute no text).

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(nav): line icons on every top-nav link"
```

---

### Task 3: QueriesPage — split layout, master table, basic detail pane

**Files:**
- Modify: `frontend/src/types/index.ts` (QueryOverview), `frontend/src/api/stats.ts` (getQueries), `frontend/src/hooks/useStats.ts` (useQueries)
- Create: `frontend/src/pages/QueriesPage.tsx`
- Modify: `frontend/src/App.tsx` (route), `frontend/src/components/NavBar.tsx` (queries link after exceptions), `frontend/src/i18n/en.ts` + `tr.ts`
- Test: `frontend/src/pages/QueriesPage.test.tsx`

**Interfaces:**
- Consumes: `PageIcon` from Task 2; `GET /api/stats/queries` from Task 1; `Card`, `TimeRangePicker`, `useI18n`.
- Produces: `export function QueriesPage()` at `/queries`; `frontend` type

```ts
export interface QueryOverview {
  value: string
  connection: string | null
  calls: number
  errorCount: number
  totalMs: number | null
  avgMs: number | null
  p95Ms: number | null
  lastSeen: string
}
```

`getQueries(params: StatsRangeParams & { property?: string; durationProperty?: string; limit?: number }): Promise<{ queries: QueryOverview[] }>`; hook `useQueries(sameParams)`. Task 4 extends the page's detail pane in place.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/QueriesPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { QueriesPage } from './QueriesPage'

vi.mock('../api/stats', () => ({
  getQueries: vi.fn(async () => ({
    queries: [
      {
        value: 'SELECT * FROM orders WHERE id = @p0',
        connection: 'main',
        calls: 320,
        errorCount: 2,
        totalMs: 4100,
        avgMs: 12.8,
        p95Ms: 48,
        lastSeen: '2026-07-25T10:00:00.000Z',
      },
      {
        value: 'UPDATE users SET seen = @p0',
        connection: null,
        calls: 40,
        errorCount: 0,
        totalMs: 900,
        avgMs: 22.5,
        p95Ms: 60,
        lastSeen: '2026-07-25T09:00:00.000Z',
      },
    ],
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
}))

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({ events: [], hasMore: false, archivedDays: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <QueriesPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists queries and auto-selects the first row into the detail pane', async () => {
  renderPage()
  expect(await screen.findByText('SELECT * FROM orders WHERE id = @p0')).toBeDefined()
  // detail pane shows the full SQL in a <pre> plus its stats
  await waitFor(() => {
    expect(document.querySelector('pre')?.textContent).toContain('SELECT * FROM orders')
  })
  // calls appears in both the row and the detail tile
  expect(screen.getAllByText('320').length).toBeGreaterThanOrEqual(2)
  expect(screen.getByText('main')).toBeDefined() // connection, detail pane only
})

it('clicking another row swaps the detail pane', async () => {
  renderPage()
  ;(await screen.findByText('UPDATE users SET seen = @p0')).click()
  await waitFor(() => {
    expect(document.querySelector('pre')?.textContent).toContain('UPDATE users SET seen')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/pages/QueriesPage.test.tsx`
Expected: FAIL — `QueriesPage` module not found.

- [ ] **Step 3: Types, API, hook**

`frontend/src/types/index.ts` — after `UserActivity`:

```ts
/** One DB-query group: events sharing a query-text property value. */
export interface QueryOverview {
  value: string
  connection: string | null
  calls: number
  errorCount: number
  totalMs: number | null
  avgMs: number | null
  p95Ms: number | null
  lastSeen: string
}
```

`frontend/src/api/stats.ts` — add `QueryOverview` to the type import and:

```ts
export function getQueries(
  params: StatsRangeParams & { property?: string; durationProperty?: string; limit?: number },
): Promise<{ queries: QueryOverview[] }> {
  return api.get<{ queries: QueryOverview[] }>(`/api/stats/queries${buildQuery(params)}`)
}
```

`frontend/src/hooks/useStats.ts` — add `getQueries` to the import and:

```ts
export function useQueries(params: StatsRangeParams & { property?: string; durationProperty?: string; limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'queries', params],
    queryFn: () => getQueries(params),
    ...KEEP_PREVIOUS,
  })
}
```

- [ ] **Step 4: i18n keys**

`frontend/src/i18n/en.ts` — `nav`: add `queries: 'Queries',`; new section after `exceptions`:

```ts
  queries: {
    title: 'Queries',
    query: 'Query',
    connection: 'Connection',
    calls: 'Calls',
    total: 'Total',
    avg: 'AVG',
    p95: 'P95',
    lastSeen: 'Last seen',
    errors: 'Errors',
    openInEvents: 'Open in Events',
    recentOccurrences: 'Recent occurrences',
    queryProperty: 'Query property',
    durationProperty: 'Duration property',
    noQueries: 'No query events in the selected range.',
    noQueriesHint:
      'This page groups events that carry a SQL-text property (default "commandText") and a duration property (default "elapsed") — EF Core\'s "Executed DbCommand" log has both. See docs/ingestion-app.md for enabling it.',
  },
```

`frontend/src/i18n/tr.ts` — `nav`: `queries: 'Sorgular',`; section:

```ts
  queries: {
    title: 'Sorgular',
    query: 'Sorgu',
    connection: 'Bağlantı',
    calls: 'Çağrı',
    total: 'Toplam',
    avg: 'Ort',
    p95: 'P95',
    lastSeen: 'Son görülme',
    errors: 'Hatalar',
    openInEvents: 'Olaylarda aç',
    recentOccurrences: 'Son çağrılar',
    queryProperty: 'Sorgu property\'si',
    durationProperty: 'Süre property\'si',
    noQueries: 'Seçilen aralıkta sorgu olayı yok.',
    noQueriesHint:
      'Bu sayfa SQL metni taşıyan bir property (varsayılan "commandText") ile süre property\'si (varsayılan "elapsed") olan olayları gruplar — EF Core\'un "Executed DbCommand" logu ikisini de taşır. Etkinleştirmek için docs/ingestion-app.md\'ye bakın.',
  },
```

- [ ] **Step 5: Implement the page (split layout)**

Create `frontend/src/pages/QueriesPage.tsx`:

```tsx
import { useState } from 'react'
import type { QueryOverview } from '../types'
import { useQueries } from '../hooks/useStats'
import { PageIcon } from '../components/icons'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { useI18n } from '../i18n'

const DEFAULT_RANGE_HOURS = 24
const ROW_LIMIT = 50

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

type SortKey = 'calls' | 'total' | 'avg' | 'p95'

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** 830 -> "830 ms", 4100 -> "4.1 s" — totals can reach seconds while p95 stays in ms. */
function formatDuration(ms: number | null, locale: string): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms).toLocaleString(locale)} ms`
  return `${(ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`
}

function sortValue(row: QueryOverview, key: SortKey): number {
  if (key === 'calls') return row.calls
  if (key === 'total') return row.totalMs ?? -1
  if (key === 'avg') return row.avgMs ?? -1
  return row.p95Ms ?? -1
}

export function QueriesPage() {
  const { t, lang } = useI18n()
  const [range, setRange] = useState(defaultRange)
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [selectedValue, setSelectedValue] = useState<string | null>(null)

  const queries = useQueries({ ...range, limit: ROW_LIMIT })
  const rows = [...(queries.data?.queries ?? [])].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey))
  // master-detail: something is always selected once rows exist
  const selected = rows.find((row) => row.value === selectedValue) ?? rows[0] ?? null

  function sortableHeader(key: SortKey, label: string) {
    return (
      <th className={`${TH_CLASS} text-right`} aria-sort={sortKey === key ? 'descending' : undefined}>
        <button
          type="button"
          onClick={() => setSortKey(key)}
          className={`transition-colors hover:text-fg ${sortKey === key ? 'text-fg' : ''}`}
        >
          {label}
          {sortKey === key ? ' ↓' : ''}
        </button>
      </th>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <PageIcon name="queries" className="size-5" />
          {t.queries.title}
        </h1>
        <TimeRangePicker
          from={range.from}
          to={range.to}
          onChange={(next) => {
            if (next.from) setRange({ from: next.from, to: next.to ?? new Date().toISOString() })
          }}
        />
      </div>

      {queries.error && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queries.error.message}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-0 overflow-auto lg:w-1/2">
          <table className="w-full">
            <thead className="sticky top-0 border-b border-border bg-surface">
              <tr>
                <th className={TH_CLASS}>{t.queries.query}</th>
                {sortableHeader('calls', t.queries.calls)}
                {sortableHeader('total', t.queries.total)}
                {sortableHeader('avg', t.queries.avg)}
                {sortableHeader('p95', t.queries.p95)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.value}
                  onClick={() => setSelectedValue(row.value)}
                  className={`cursor-pointer border-b border-border last:border-b-0 ${
                    selected?.value === row.value ? 'bg-surface-raised' : 'hover:bg-surface-hover'
                  }`}
                >
                  <td className={`${TD_CLASS} max-w-0 truncate font-mono`} title={row.value}>
                    {row.value}
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.calls.toLocaleString(lang)}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatDuration(row.totalMs, lang)}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatDuration(row.avgMs, lang)}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{formatDuration(row.p95Ms, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {queries.data && rows.length === 0 && (
            <div className="p-4">
              <p className="text-sm text-fg">{t.queries.noQueries}</p>
              <p className="mt-2 text-sm text-fg-muted">{t.queries.noQueriesHint}</p>
            </div>
          )}
        </Card>

        <Card className="min-h-0 overflow-y-auto p-4 lg:w-1/2">
          {selected && (
            <div className="flex flex-col gap-4">
              <pre className="max-h-48 overflow-auto rounded-lg bg-surface-raised p-3 font-mono text-xs whitespace-pre-wrap text-fg">
                {selected.value}
              </pre>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <DetailTile label={t.queries.calls} value={selected.calls.toLocaleString(lang)} />
                <DetailTile label={t.queries.total} value={formatDuration(selected.totalMs, lang)} />
                <DetailTile label={t.queries.avg} value={formatDuration(selected.avgMs, lang)} />
                <DetailTile label={t.queries.p95} value={formatDuration(selected.p95Ms, lang)} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-fg-muted">{t.queries.connection}</dt>
                <dd className="text-right font-mono text-fg">{selected.connection ?? '—'}</dd>
                <dt className="text-fg-muted">{t.queries.lastSeen}</dt>
                <dd className="text-right text-fg">{formatTimestamp(selected.lastSeen, lang)}</dd>
                {selected.errorCount > 0 && (
                  <>
                    <dt className="text-fg-muted">{t.queries.errors}</dt>
                    <dd className="text-right font-medium text-level-error">
                      {selected.errorCount.toLocaleString(lang)}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="tabular text-lg font-semibold text-fg">{value}</p>
    </div>
  )
}
```

- [ ] **Step 6: Route + nav link**

- `frontend/src/App.tsx`: `import { QueriesPage } from './pages/QueriesPage'`; after the `/exceptions` route add `<Route path="/queries" element={<QueriesPage />} />`.
- `frontend/src/components/NavBar.tsx`: after the exceptions entry add `{ to: '/queries', label: t.nav.queries, end: false, icon: 'queries' },`.

- [ ] **Step 7: Run tests**

Run: `npm run test -- src/pages/QueriesPage.test.tsx` → PASS (2)
Run: `npm run test` then `npm run build` → all green (build catches unused imports).

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(queries): split master-detail queries lens page"
```

---

### Task 4: Detail pane depth — trend, recent occurrences, Events link, property inputs

**Files:**
- Modify: `frontend/src/pages/QueriesPage.tsx`
- Test: `frontend/src/pages/QueriesPage.test.tsx`

**Interfaces:**
- Consumes: `Sparkline` (`filter/color/from/to` props), `getEvents({ filter, from, to, count })` from `../api/events` (newest first), `quote` from `../lib/filter`, `LevelBadge`, `LEVEL_HEX`, `Input` from `../components/ui/Input` (standard `InputHTMLAttributes`), `useQuery` from `@tanstack/react-query`.
- Produces: final QueriesPage behavior; no new exports.

- [ ] **Step 1: Extend the tests (fail first)**

In `frontend/src/pages/QueriesPage.test.tsx` replace the `../api/events` mock with one that returns occurrences, and add two tests:

```tsx
vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({
    events: [
      {
        id: 9,
        timestamp: '2026-07-25T10:00:00.000Z',
        level: 'Information',
        message: 'Executed DbCommand (12ms) SELECT * FROM orders WHERE id = @p0',
        messageTemplate: null,
        properties: '{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":12}',
        exception: null,
        ingestedAt: '2026-07-25T10:00:01.000Z',
        traceId: null,
        spanId: null,
      },
    ],
    hasMore: false,
    archivedDays: [],
  })),
}))
```

```tsx
it('shows recent occurrences with their duration and an Events link', async () => {
  renderPage()
  await screen.findByText('SELECT * FROM orders WHERE id = @p0')
  expect(await screen.findByText('Recent occurrences')).toBeDefined()
  expect(await screen.findByText('12 ms')).toBeDefined()

  const link = screen.getByText('Open in Events →')
  const href = link.getAttribute('href') ?? ''
  expect(decodeURIComponent(href.replaceAll('+', ' '))).toContain("commandText = 'SELECT * FROM orders WHERE id = @p0'")
})

it('lets the user change the query property', async () => {
  renderPage()
  await screen.findByText('SELECT * FROM orders WHERE id = @p0')
  const input = screen.getByLabelText('Query property') as HTMLInputElement
  expect(input.value).toBe('commandText')
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm run test -- src/pages/QueriesPage.test.tsx`
Expected: the 2 new tests FAIL (no occurrences section, no property input); the Task 3 tests still pass.

- [ ] **Step 3: Implement**

In `frontend/src/pages/QueriesPage.tsx`:

- Extend imports:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getEvents } from '../api/events'
import { LevelBadge } from '../components/LevelBadge'
import { Sparkline } from '../components/Sparkline'
import { Input } from '../components/ui/Input'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
```

- Add state next to the others: `const [property, setProperty] = useState('commandText')` and `const [durationProperty, setDurationProperty] = useState('elapsed')`; pass both to the hook: `useQueries({ ...range, property, durationProperty, limit: ROW_LIMIT })`.
- Property inputs in the header row (between the `h1` and the `TimeRangePicker`), labelled for the test:

```tsx
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.queries.queryProperty}
            <Input
              aria-label={t.queries.queryProperty}
              value={property}
              onChange={(event) => setProperty(event.target.value)}
              className="w-36 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.queries.durationProperty}
            <Input
              aria-label={t.queries.durationProperty}
              value={durationProperty}
              onChange={(event) => setDurationProperty(event.target.value)}
              className="w-28 font-mono text-xs"
            />
          </label>
        </div>
```

- Selected-query filter + occurrences fetch (top level of the component, after `selected` is computed — hooks must not be conditional, so use `enabled`):

```tsx
  const selectedFilter = selected ? `${property} = ${quote(selected.value)}` : ''
  const occurrences = useQuery({
    queryKey: ['query-occurrences', property, selected?.value, range],
    queryFn: () => getEvents({ filter: selectedFilter, from: range.from, to: range.to, count: 5 }),
    enabled: selected !== null,
  })
```

- In the detail pane, after the `<dl>` block:

```tsx
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">
                    {t.queries.recentOccurrences}
                  </p>
                  <Link
                    to={`/events?${new URLSearchParams({ from: range.from, to: range.to, filter: selectedFilter }).toString()}`}
                    className="text-xs text-fg-muted transition-colors hover:text-accent"
                  >
                    {t.queries.openInEvents} →
                  </Link>
                </div>
                <div className="mt-2">
                  <Sparkline filter={selectedFilter} color={LEVEL_HEX.Information} from={range.from} to={range.to} />
                </div>
                <ul className="mt-2">
                  {(occurrences.data?.events ?? []).map((event) => {
                    const props = event.properties ? (JSON.parse(event.properties) as Record<string, unknown>) : {}
                    const elapsed = props[durationProperty]
                    return (
                      <li
                        key={event.id}
                        className="flex items-baseline gap-2 border-b border-border px-1 py-1 text-sm last:border-b-0"
                      >
                        <span className="whitespace-nowrap text-xs text-fg-muted">
                          {formatTimestamp(event.timestamp, lang)}
                        </span>
                        <LevelBadge level={event.level} />
                        <span className="ml-auto tabular text-fg-muted">
                          {typeof elapsed === 'number' ? `${Math.round(elapsed).toLocaleString(lang)} ms` : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/pages/QueriesPage.test.tsx` → PASS (4)
Run: `npm run test` and `npm run build` → all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(queries): rich detail pane — trend, occurrences, Events link"
```

---

### Task 5: traffic-sim query events + docs

**Files:**
- Modify: `test/traffic-sim/traffic-sim.py` (api-service Information branch, ~line 105)
- Modify: `docs/api.md`, `docs/ingestion-app.md`, `docs/frontend.md`

**Interfaces:** none — data generation + documentation.

- [ ] **Step 1: Simulate EF-style query events**

In `test/traffic-sim/traffic-sim.py`, add near the other constants (top of file, next to `PATHS`/`EXCEPTIONS`):

```python
SQL_QUERIES = [
    "SELECT * FROM orders WHERE id = @p0",
    "SELECT * FROM users WHERE email = @p0",
    "UPDATE orders SET status = @p0 WHERE id = @p1",
    "INSERT INTO audit_log (user_id, action) VALUES (@p0, @p1)",
    "SELECT o.*, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.created_at > @p0",
    "DELETE FROM sessions WHERE expires_at < @p0",
]
```

In `build_event`, inside the `api` service's final `else` (Information) branch, emit a query event ~35% of the time instead of the request event:

```python
        else:
            if random.random() < 0.35:
                # EF Core-shaped DB query log: feeds the /queries lens page
                event["@mt"] = "Executed DbCommand ({elapsed}ms) {commandText}"
                event["commandText"] = random.choice(SQL_QUERIES)
                event["elapsed"] = (
                    random.randrange(500, 2000) if random.random() < 0.05 else random.randrange(2, 180)
                )
                event["connection"] = random.choice(["main", "replica"])
            else:
                event["@mt"] = "Handled {Method} {Path} in {Elapsed} ms"
                event["Method"] = random.choice(METHODS)
                event["Path"] = random.choice(PATHS)
                event["Elapsed"] = random.randrange(3, 400)
                event["UserId"] = _user()
```

Sanity-check locally: `python test/traffic-sim/traffic-sim.py --help` (or a dry-run flag if the script offers one; at minimum `python -m py_compile test/traffic-sim/traffic-sim.py`).

- [ ] **Step 2: Documentation**

- `docs/api.md` — add under the stats endpoints, matching the file's existing style:

```
GET /api/stats/queries?from=&to=&filter=&property=commandText&durationProperty=elapsed&connectionProperty=connection&limit=50
  Groups events carrying the query-text property (SQL string) and aggregates
  the duration property per group: { queries: [ { value, connection, calls,
  errorCount, totalMs, avgMs, p95Ms, lastSeen } ] }, most total time first.
  Property names must match [A-Za-z0-9_.]. 400 on invalid input.
```

- `docs/ingestion-app.md` — new short section:

```
--- SENDING DB QUERY LOGS (feeds the Queries page) ---

The /queries page groups events that carry a SQL-text property (default
commandText) plus a duration property (default elapsed).

EF Core + Serilog: allow the command events through and they arrive already
shaped like that:

  .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command",
                         LogEventLevel.Information)

Any other stack works too: log an event with a commandText string property
and an elapsed (ms) number property; add a connection property to fill the
Connection column.
```

- `docs/frontend.md` — in the PAGES list after `/exceptions` add:

```
/queries     DB query lens, split master-detail: left a sortable table (calls,
             total, avg, p95 per SQL text), right the selected query's detail
             (full SQL, stat tiles, connection, trend, recent occurrences,
             Events deep link); property names configurable (commandText/elapsed)
```

and update the nav order line to `... Events, Requests, Exceptions, Queries, Services, ...`, mentioning that every nav link now carries a small line icon.

- [ ] **Step 3: Commit**

```bash
git add test/traffic-sim/traffic-sim.py docs/api.md docs/ingestion-app.md docs/frontend.md
git commit -m "feat(sim): EF-style query events; document /api/stats/queries and the Queries page"
```

---

### Task 6: Full verification + deploy to the test server

**Files:** none (verification + deploy).

- [ ] **Step 1: Full suites**

Run (repo root): `dotnet test backend --nologo -v q` → all pass.
Run (frontend/): `npm run test` and `npm run build` → all pass.

- [ ] **Step 2: Local end-to-end check (verify skill pattern)**

Start the backend with an isolated DB + the Vite dev server, seed a few EF-style
query events via `/api/events/raw` (properties `commandText`, `elapsed`,
`connection`), open `/queries`, confirm: rows, auto-selected detail pane,
occurrences list, Events deep link. Stop both servers afterwards.

- [ ] **Step 3: Deploy the development build to 192.168.1.131**

Per the deploy runbook (memory `test-server-deploy`): ship source WITHOUT
overwriting the server's `docker-compose.yml` (it carries the
`LogHarbor__AllowInsecureCookie=true` delta), rebuild, verify:

```bash
git archive --format=tar HEAD | ssh root@192.168.1.131 'tar -x -C /app/logharbor --exclude=docker-compose.yml'
ssh root@192.168.1.131 'cd /app/logharbor && docker compose build && docker compose up -d'   # run in background, takes minutes
# then:
ssh root@192.168.1.131 "docker inspect logharbor --format '{{.State.Health.Status}}'"        # healthy
ssh root@192.168.1.131 'curl -s http://127.0.0.1:5000/healthz'                               # eventCount unchanged
# new bundle proof: fetch / and grep the referenced /assets/index-*.js for "commandText"
```

Also restart the traffic-sim service if it runs on that host (`systemctl restart traffic-sim` — check `test/traffic-sim/traffic-sim.service` deployment notes / README) so the new query events start flowing.

- [ ] **Step 4: Report**

Tell the user the page is live on http://192.168.1.131:5000 (nav: Sorgular/Queries) and that `main` is still untouched pending their OK.
