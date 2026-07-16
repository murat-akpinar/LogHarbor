# Trace Correlation (Phase 12-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store CLEF `@tr`/`@sp` (W3C trace/span ids) as first-class columns, make them filterable via `@TraceId`/`@SpanId` query builtins, and add a "View trace" action to EventDetail so one click shows every event of a request.

**Architecture:** `trace_id`/`span_id` columns on `events` and `events_cache` (migration 008), new fields on the `Event` record flowing through every store, the archive JSONL round trip (which serializes the record, so old segments hydrate with nulls), and the API JSON (record serialization). ClefParser hoists `@tr`/`@sp` — today `ExtractProperties` skips `@`-keys, so this data is silently discarded. The query parser maps two new builtins to the columns. This is the prerequisite block for OTLP ingestion (Phase 12-B), which writes the same columns.

**Tech Stack:** .NET 8 / SQLite (backend), React 18 + TypeScript + Vitest (frontend). No new dependencies.

## Global Constraints (rules.md)

- Nullable reference types + warnings-as-errors: new record fields are `string?`.
- Parameterized SQL only; list columns explicitly, never `SELECT *`.
- All code, comments, docs, commit messages in English; imperative commit subject ≤ 72 chars.
- Every store method and parser rule change gets a unit test; endpoint tests use WebApplicationFactory.
- Frontend: TypeScript strict, no `any`; Tailwind classes, no inline styles; API access only via `src/api`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Backend tests: `dotnet test backend` (from repo root). Frontend tests: `npm run test` (in `frontend/`, vitest run).

## Ordering

Task 1 → 2 → 3 → 4 → 5 → 6. Each task compiles and passes the full suite on its own; 2 depends on 1's columns, 5 proves 2–4 end to end, 6 consumes the API contract from 5.

---

### Task 1: Migration 008 — trace columns

**Files:**
- Create: `backend/LogHarbor.Api/Migrations/008_trace_correlation.sql`

**Interfaces:**
- Consumes: migration runner conventions (numbered `.sql` files applied in filename order; `backend/LogHarbor.Core/Storage/MigrationRunner.cs`).
- Produces: nullable `trace_id`/`span_id` TEXT columns on `events` AND `events_cache`; partial index `ix_events_trace`. Later tasks read/write these columns.

- [ ] **Step 1: Write the migration**

Create `backend/LogHarbor.Api/Migrations/008_trace_correlation.sql`:

```sql
-- 008: trace/span correlation columns (docs/data-model.md). CLEF @tr/@sp — and,
-- later, OTLP trace_id/span_id — land here so one filter finds a whole request.
-- events_cache gets the same columns or the archive hydrate INSERT would fail.

ALTER TABLE events ADD COLUMN trace_id TEXT;
ALTER TABLE events ADD COLUMN span_id TEXT;
ALTER TABLE events_cache ADD COLUMN trace_id TEXT;
ALTER TABLE events_cache ADD COLUMN span_id TEXT;

-- partial: most events carry no trace, so the index only pays for rows that do
CREATE INDEX ix_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;
```

No index on `events_cache`: it holds at most a few hydrated days and is scanned rarely.

- [ ] **Step 2: Verify the migration applies cleanly**

Run: `dotnet test backend`
Expected: PASS — every test constructor runs `MigrationRunner.Apply`, so a broken migration fails the whole suite; a green suite proves 008 applies.

- [ ] **Step 3: Commit**

```bash
git add backend/LogHarbor.Api/Migrations/008_trace_correlation.sql
git commit -m "feat: add trace_id/span_id columns (migration 008)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Event record + storage plumbing

**Files:**
- Modify: `backend/LogHarbor.Core/Events/Event.cs`
- Modify: `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` (Columns const, `WriteBatchAsync`, `FindAsync` cache ordinal, `ReadEvent`)
- Modify: `backend/LogHarbor.Core/Storage/SqliteArchiveStore.cs` (EventColumns const, `CompleteHydrationAsync`, `ReadEvent`)
- Test: `backend/LogHarbor.Tests/Storage/SqliteEventStoreTests.cs`
- Test: `backend/LogHarbor.Tests/Archiving/ArchiverTests.cs`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `Event` record with trailing optional `string? TraceId = null, string? SpanId = null` — every later task constructs/reads these. Store round trips (write, query, find, archive export → hydrate → query) preserve both fields. Archive JSONL keys are camelCase `traceId`/`spanId`; segments written before this change deserialize with nulls.

- [ ] **Step 1: Write the failing tests**

In `backend/LogHarbor.Tests/Storage/SqliteEventStoreTests.cs`, add:

```csharp
[Fact]
public async Task WriteBatch_PersistsTraceAndSpanIds()
{
    var written = MakeEvent() with
    {
        TraceId = "0af7651916cd43dd8448eb211c80319c",
        SpanId = "b7ad6b7169203331",
    };

    var ids = await _store.WriteBatchAsync([written]);

    var found = await _store.FindAsync(ids[0]);
    Assert.Equal(written.TraceId, found!.TraceId);
    Assert.Equal(written.SpanId, found.SpanId);
}

[Fact]
public async Task WriteBatch_NullTraceIds_StoredAsNull()
{
    var ids = await _store.WriteBatchAsync([MakeEvent()]);

    var found = await _store.FindAsync(ids[0]);
    Assert.Null(found!.TraceId);
    Assert.Null(found.SpanId);
}
```

In `backend/LogHarbor.Tests/Archiving/ArchiverTests.cs`:

1. Extend the `MakeEvent` helper with trailing optional trace parameters:

```csharp
private static Event MakeEvent(string timestamp, string message, string? properties = null,
    string? exception = null, string level = "Information",
    string? traceId = null, string? spanId = null) =>
    new(0, timestamp, level, message, "tpl {X}", properties, exception, timestamp, traceId, spanId);
```

2. In `SeedTwoOldDaysAndOneRecentAsync`, give the first seeded event a trace (replace the existing first `MakeEvent(...)` entry):

```csharp
MakeEvent("2026-05-01T08:00:00.0000000Z", "connection refused by peer",
    """{"UserId":7,"Host":"db-1"}""", "System.Net.SocketException: boom\n   at Api.Dial()", "Error",
    traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331"),
```

The existing `ArchiveHydrateRoundTrip_PreservesEveryEventFieldAndId` fact compares full records, so it now also proves export → hydrate keeps the trace fields.

3. Add a fact that finds a hydrated event by id (this specifically catches the `segment_day` ordinal shift in `FindAsync`):

```csharp
[Fact]
public async Task Find_HydratedEvent_PreservesTraceIds()
{
    var seeded = await SeedTwoOldDaysAndOneRecentAsync();
    await _archiver.RunArchiveAsync(Now);
    await HydrateAsync("2026-05-01", "2026-05-02");

    var traced = seeded.First(item => item.TraceId is not null);
    Assert.Equal(traced, await _eventStore.FindAsync(traced.Id));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~SqliteEventStoreTests|FullyQualifiedName~ArchiverTests"`
Expected: FAIL to compile — `Event` has no `TraceId`/`SpanId`, `MakeEvent` has no such parameters.

- [ ] **Step 3: Implement**

`backend/LogHarbor.Core/Events/Event.cs` — full new content:

```csharp
namespace LogHarbor.Core.Events;

/// <summary>One structured log entry (docs/data-model.md). Timestamps are UTC ISO-8601 strings.
/// TraceId/SpanId are lowercase W3C hex; trailing defaults keep pre-trace call sites valid.</summary>
public sealed record Event(
    long Id,
    string Timestamp,
    string Level,
    string Message,
    string? MessageTemplate,
    string? Properties,
    string? Exception,
    string IngestedAt,
    string? TraceId = null,
    string? SpanId = null);
```

`backend/LogHarbor.Core/Storage/SqliteEventStore.cs`:

1. Columns const:

```csharp
private const string Columns =
    "id, timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id";
```

2. `WriteBatchAsync` — INSERT statement:

```csharp
command.CommandText =
    "INSERT INTO events (timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id) " +
    "VALUES (@timestamp, @level, @message, @messageTemplate, @properties, @exception, @ingestedAt, @traceId, @spanId); " +
    "SELECT last_insert_rowid();";
```

parameter declarations (after the existing `ingestedAt` line):

```csharp
var traceId = command.Parameters.Add("@traceId", SqliteType.Text);
var spanId = command.Parameters.Add("@spanId", SqliteType.Text);
```

loop body (after the existing `ingestedAt.Value = item.IngestedAt;` line):

```csharp
traceId.Value = (object?)item.TraceId ?? DBNull.Value;
spanId.Value = (object?)item.SpanId ?? DBNull.Value;
```

3. `FindAsync` — the cache query appends `segment_day` after `{Columns}`, which now has 10 columns, so the ordinal moves from 8 to 10:

```csharp
await TouchSegmentAsync(connection, cacheReader.GetString(10), cancellationToken);
```

4. `ReadEvent`:

```csharp
private static Event ReadEvent(SqliteDataReader reader) => new(
    reader.GetInt64(0),
    reader.GetString(1),
    reader.GetString(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetString(5),
    reader.IsDBNull(6) ? null : reader.GetString(6),
    reader.GetString(7),
    reader.IsDBNull(8) ? null : reader.GetString(8),
    reader.IsDBNull(9) ? null : reader.GetString(9));
```

`backend/LogHarbor.Core/Storage/SqliteArchiveStore.cs`:

1. EventColumns const:

```csharp
private const string EventColumns =
    "id, timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id";
```

2. `CompleteHydrationAsync` — INSERT statement:

```csharp
insert.CommandText =
    "INSERT INTO events_cache " +
    "(id, timestamp, level, message, message_template, properties, exception, ingested_at, trace_id, span_id, segment_day) " +
    "VALUES (@id, @timestamp, @level, @message, @messageTemplate, @properties, @exception, @ingestedAt, @traceId, @spanId, @day);";
```

parameter declarations (after the existing `ingestedAt` line, before the `@day` line):

```csharp
var traceId = insert.Parameters.Add("@traceId", SqliteType.Text);
var spanId = insert.Parameters.Add("@spanId", SqliteType.Text);
```

loop body (after `ingestedAt.Value = item.IngestedAt;`):

```csharp
traceId.Value = (object?)item.TraceId ?? DBNull.Value;
spanId.Value = (object?)item.SpanId ?? DBNull.Value;
```

3. `ReadEvent` — same 10-column shape as SqliteEventStore's (code above).

No change to `Archiver.cs`: segment files serialize the `Event` record (`JsonSerializerDefaults.Web`), so `traceId`/`spanId` join the JSONL automatically and old segments (no such keys) deserialize as null via the constructor defaults.

- [ ] **Step 4: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS, including the three new facts and the extended round-trip fact.

- [ ] **Step 5: Commit**

```bash
git add backend/LogHarbor.Core/Events/Event.cs backend/LogHarbor.Core/Storage/SqliteEventStore.cs backend/LogHarbor.Core/Storage/SqliteArchiveStore.cs backend/LogHarbor.Tests/Storage/SqliteEventStoreTests.cs backend/LogHarbor.Tests/Archiving/ArchiverTests.cs
git commit -m "feat: carry trace_id/span_id through Event and all stores" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ClefParser @tr/@sp mapping + data-model docs

**Files:**
- Modify: `backend/LogHarbor.Core/Events/ClefParser.cs` (the `new Event(...)` construction in `TryParse`)
- Modify: `docs/data-model.md` (EVENT table, CLEF MAPPING, INGESTION NORMALIZATION, SQLITE SCHEMA sections)
- Test: `backend/LogHarbor.Tests/Events/ClefParserTests.cs`

**Interfaces:**
- Consumes: `Event.TraceId`/`Event.SpanId` from Task 2.
- Produces: CLEF `@tr` → `TraceId`, `@sp` → `SpanId`, both lowercased; absent keys → null. `@`-prefix exclusion from properties already covers the new keys.

- [ ] **Step 1: Write the failing tests**

In `backend/LogHarbor.Tests/Events/ClefParserTests.cs`, add:

```csharp
[Fact]
public void TraceAndSpanIds_AreParsed_AndLowercased()
{
    var parsed = Parse(
        """{"@t":"2026-07-13T10:00:00Z","@tr":"0AF7651916CD43DD8448EB211C80319C","@sp":"B7AD6B7169203331"}""");

    Assert.Equal("0af7651916cd43dd8448eb211c80319c", parsed.TraceId);
    Assert.Equal("b7ad6b7169203331", parsed.SpanId);
    Assert.Null(parsed.Properties); // @-keys never leak into properties
}

[Fact]
public void MissingTraceAndSpanIds_AreNull()
{
    var parsed = Parse("""{"@t":"2026-07-13T10:00:00Z"}""");

    Assert.Null(parsed.TraceId);
    Assert.Null(parsed.SpanId);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~ClefParserTests"`
Expected: FAIL — `TraceAndSpanIds_AreParsed_AndLowercased` asserts non-null `TraceId`, parser returns null.

- [ ] **Step 3: Implement**

In `ClefParser.TryParse`, extend the `Event` construction:

```csharp
parsed = new Event(
    Id: 0,
    Timestamp: FormatTimestamp(timestamp),
    Level: MapLevel(GetString(root, "@l")),
    Message: message,
    MessageTemplate: messageTemplate,
    Properties: ExtractProperties(root),
    Exception: GetString(root, "@x"),
    IngestedAt: FormatTimestamp(serverTime),
    // lowercased: W3C ids are lowercase hex and OTLP ingestion will store the same
    // canonical form, so @TraceId = '...' filters stay exact-match reliable
    TraceId: GetString(root, "@tr")?.ToLowerInvariant(),
    SpanId: GetString(root, "@sp")?.ToLowerInvariant());
```

- [ ] **Step 4: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS.

- [ ] **Step 5: Update docs/data-model.md**

Four edits:

1. EVENT table — after the `ingested_at` row, add:

```
trace_id        TEXT        nullable, W3C trace id (lowercase hex), from @tr; indexed (partial)
span_id         TEXT        nullable, W3C span id (lowercase hex), from @sp
```

2. CLEF MAPPING — after the `@x` row, add:

```
@tr        ->  trace_id (lowercased)
@sp        ->  span_id (lowercased)
```

3. INGESTION NORMALIZATION — append:

```
trace/span: @tr and @sp are lowercased on ingest. W3C ids are lowercase hex and
  OTLP ingestion stores the same canonical form, so @TraceId filters exact-match.
```

4. SQLITE SCHEMA — inside the `CREATE TABLE events (...)` listing add `trace_id TEXT,` and `span_id TEXT,` after `ingested_at TEXT NOT NULL,`; after the existing index lines add:

```
CREATE INDEX ix_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;
```

and extend the events_cache note: `events_cache: same columns as events (including trace_id/span_id) + segment_day TEXT`.

- [ ] **Step 6: Commit**

```bash
git add backend/LogHarbor.Core/Events/ClefParser.cs backend/LogHarbor.Tests/Events/ClefParserTests.cs docs/data-model.md
git commit -m "feat: parse CLEF @tr/@sp into trace_id/span_id" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: @TraceId / @SpanId query builtins + query-language docs

**Files:**
- Modify: `backend/LogHarbor.Core/Query/QueryParser.cs` (`BuiltinColumns` dictionary)
- Modify: `docs/query-language.md` (PROPERTY ACCESS section)
- Test: `backend/LogHarbor.Tests/Query/SqlTranslatorTests.cs`

**Interfaces:**
- Consumes: `trace_id`/`span_id` columns (Task 1).
- Produces: filter strings `@TraceId = '...'` / `@SpanId = '...'` translate to `trace_id = @q0` / `span_id = @q0`. The frontend (Task 6) emits exactly `@TraceId = '<id>'`.

- [ ] **Step 1: Write the failing test**

In `backend/LogHarbor.Tests/Query/SqlTranslatorTests.cs`, add:

```csharp
[Theory]
[InlineData("@TraceId = '0af7651916cd43dd8448eb211c80319c'", "trace_id = @q0", "0af7651916cd43dd8448eb211c80319c")]
[InlineData("@SpanId = 'b7ad6b7169203331'", "span_id = @q0", "b7ad6b7169203331")]
public void TraceBuiltins_MapToTraceColumns(string filter, string expectedSql, string expectedValue)
{
    var result = Translate(filter);

    Assert.Equal(expectedSql, result.Sql);
    Assert.Equal(Pairs(Pair("@q0", expectedValue)), result.Parameters);
}
```

(`Translate`, `Pairs`, `Pair` are existing helpers in this test class.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test backend --filter "FullyQualifiedName~SqlTranslatorTests"`
Expected: FAIL — `QueryParseException: unknown built-in field '@TraceId'`.

- [ ] **Step 3: Implement**

In `QueryParser.BuiltinColumns`, add two entries:

```csharp
["MessageTemplate"] = "message_template",
["TraceId"] = "trace_id",
["SpanId"] = "span_id",
```

- [ ] **Step 4: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS.

- [ ] **Step 5: Update docs/query-language.md**

In PROPERTY ACCESS, extend the builtin list line to:

```
  @Level, @Message, @Timestamp, @Exception, @MessageTemplate, @TraceId, @SpanId
```

and after the @MessageTemplate paragraph add:

```
@TraceId and @SpanId are the W3C trace/span ids (CLEF @tr/@sp, lowercase hex):
  @TraceId = '0af7651916cd43dd8448eb211c80319c' returns every event of one
  request, across services.
```

- [ ] **Step 6: Commit**

```bash
git add backend/LogHarbor.Core/Query/QueryParser.cs backend/LogHarbor.Tests/Query/SqlTranslatorTests.cs docs/query-language.md
git commit -m "feat: add @TraceId and @SpanId query builtins" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end endpoint test + CSV export columns

**Files:**
- Modify: `backend/LogHarbor.Api/Endpoints/ExportEndpoints.cs` (`ToCsv`)
- Test: `backend/LogHarbor.Tests/Api/IngestionEndpointsTests.cs`

**Interfaces:**
- Consumes: Tasks 2–4. The API JSON already carries `traceId`/`spanId` (the `Event` record serializes camelCase); JSON export likewise. Only the hand-built CSV needs columns.
- Produces: proven API contract — `traceId`/`spanId` in `GET /api/events` JSON, `@TraceId` filter round trip over HTTP, CSV header `...,ingestedAt,traceId,spanId`.

- [ ] **Step 1: Write the failing test**

In `backend/LogHarbor.Tests/Api/IngestionEndpointsTests.cs`, add (uses the existing `CreateApiKeyAsync`/`PostRawAsync` helpers):

```csharp
[Fact]
public async Task IngestedTraceIds_AreQueryableViaTraceIdFilter()
{
    var token = await CreateApiKeyAsync();
    var body =
        """{"@t":"2026-07-13T10:00:00Z","@m":"traced","@tr":"0af7651916cd43dd8448eb211c80319c","@sp":"b7ad6b7169203331"}""" + "\n" +
        """{"@t":"2026-07-13T10:00:01Z","@m":"untraced"}""";
    var response = await PostRawAsync(body, token);
    Assert.Equal(HttpStatusCode.Created, response.StatusCode);

    var page = await _client.GetFromJsonAsync<JsonElement>(
        "/api/events?filter=" + Uri.EscapeDataString("@TraceId = '0af7651916cd43dd8448eb211c80319c'"));

    var matched = page.GetProperty("events").EnumerateArray().Single();
    Assert.Equal("traced", matched.GetProperty("message").GetString());
    Assert.Equal("0af7651916cd43dd8448eb211c80319c", matched.GetProperty("traceId").GetString());
    Assert.Equal("b7ad6b7169203331", matched.GetProperty("spanId").GetString());
}

[Fact]
public async Task CsvExport_IncludesTraceColumns()
{
    var token = await CreateApiKeyAsync();
    await PostRawAsync(
        """{"@t":"2026-07-13T10:00:00Z","@m":"traced","@tr":"0af7651916cd43dd8448eb211c80319c"}""", token);

    var csv = await _client.GetStringAsync("/api/events/export?format=csv");

    Assert.StartsWith("id,timestamp,level,message,messageTemplate,properties,exception,ingestedAt,traceId,spanId", csv);
    Assert.Contains("\"0af7651916cd43dd8448eb211c80319c\"", csv);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~IngestionEndpointsTests"`
Expected: `IngestedTraceIds_...` PASSES already (Tasks 2–4 built the pipe — it stays as the regression gate); `CsvExport_IncludesTraceColumns` FAILS on the header assert.

- [ ] **Step 3: Implement the CSV columns**

In `ExportEndpoints.ToCsv`, header line:

```csharp
csv.Append("id,timestamp,level,message,messageTemplate,properties,exception,ingestedAt,traceId,spanId\n");
```

and the row loop — the `IngestedAt` cell stops being last:

```csharp
csv.Append(CsvCell(item.IngestedAt)).Append(',');
csv.Append(CsvCell(item.TraceId)).Append(',');
csv.Append(CsvCell(item.SpanId)).Append('\n');
```

- [ ] **Step 4: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/LogHarbor.Api/Endpoints/ExportEndpoints.cs backend/LogHarbor.Tests/Api/IngestionEndpointsTests.cs
git commit -m "feat: expose trace ids in events API and CSV export" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend — trace section + "View trace"

**Files:**
- Modify: `frontend/src/types/index.ts` (Event interface)
- Modify: `frontend/src/lib/filter.ts` (add exported `quote`)
- Modify: `frontend/src/pages/AnalysisPage.tsx` (delete local `quote`, import from lib)
- Modify: `frontend/src/components/EventDetail.tsx` (trace section + `onViewTrace` prop)
- Modify: `frontend/src/pages/EventsPage.tsx` (applyFilter + FilterBar remount key + wire EventDetail)
- Modify: `frontend/src/i18n/en.ts`, `frontend/src/i18n/tr.ts` (detail section keys)
- Modify: `docs/frontend.md` (EventDetail description)
- Test: `frontend/src/components/EventDetail.test.tsx` (create)

**Interfaces:**
- Consumes: API JSON fields `traceId`/`spanId` (Task 5), filter syntax `@TraceId = '...'` (Task 4).
- Produces: `Event` TS type with `traceId: string | null; spanId: string | null`; `quote(value: string): string` exported from `src/lib/filter.ts`; `EventDetail` prop `onViewTrace?: (traceId: string) => void`.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/EventDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { EventDetail } from './EventDetail'
import type { Event } from '../types'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const base: Event = {
  id: 1,
  timestamp: '2026-07-13T10:00:00.0000000Z',
  level: 'Error',
  message: 'boom',
  messageTemplate: null,
  properties: null,
  exception: null,
  ingestedAt: '2026-07-13T10:00:01.0000000Z',
  traceId: null,
  spanId: null,
}

function renderDetail(event: Event, onViewTrace: (traceId: string) => void) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <EventDetail event={event} highlightTerms={[]} onClose={() => {}} onViewTrace={onViewTrace} />
    </LanguageProvider>,
  )
}

it('hides the trace section when the event has no trace id', () => {
  renderDetail(base, () => {})
  expect(screen.queryByText('View trace')).toBeNull()
})

it('shows the trace id and requests the trace filter on click', () => {
  const onViewTrace = vi.fn()
  renderDetail({ ...base, traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331' }, onViewTrace)

  expect(screen.getByText(/0af7651916cd43dd8448eb211c80319c/)).toBeDefined()
  screen.getByText('View trace').click()
  expect(onViewTrace).toHaveBeenCalledWith('0af7651916cd43dd8448eb211c80319c')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test` (in `frontend/`)
Expected: FAIL — TS error: `Event` has no `traceId`, `EventDetail` has no `onViewTrace` prop.

- [ ] **Step 3: Implement**

1. `frontend/src/types/index.ts` — extend `Event`:

```ts
export interface Event {
  id: number
  timestamp: string
  level: Level
  message: string
  messageTemplate: string | null
  properties: string | null
  exception: string | null
  ingestedAt: string
  /** W3C trace/span ids (lowercase hex), null when the event carries none. */
  traceId: string | null
  spanId: string | null
}
```

2. `frontend/src/lib/filter.ts` — add at the end:

```ts
/** Quotes a value as a filter string literal (embedded quotes doubled). */
export function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
```

3. `frontend/src/pages/AnalysisPage.tsx` — delete the local `quote` function (lines 24-26) and add `quote` to the existing import from `'../lib/filter'` (or add `import { quote } from '../lib/filter'` if none exists).

4. `frontend/src/components/EventDetail.tsx` — extend props and render the section:

```tsx
interface EventDetailProps {
  event: Event
  highlightTerms: string[]
  onClose: () => void
  onViewTrace?: (traceId: string) => void
}

export function EventDetail({ event, highlightTerms, onClose, onViewTrace }: EventDetailProps) {
```

Insert between the exception block and the properties block:

```tsx
{event.traceId && (
  <div className="mb-4">
    <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">{t.detail.trace}</h3>
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate font-mono text-xs text-fg-muted" title={event.traceId}>
        {event.traceId}
        {event.spanId && ` / ${event.spanId}`}
      </span>
      {onViewTrace && (
        <Button variant="secondary" onClick={() => onViewTrace(event.traceId!)}>
          {t.detail.viewTrace}
        </Button>
      )}
    </div>
  </div>
)}
```

5. i18n — `frontend/src/i18n/en.ts` `detail` section:

```ts
detail: {
  exception: 'Exception',
  properties: 'Properties',
  rawJson: 'Raw JSON',
  trace: 'Trace',
  viewTrace: 'View trace',
},
```

`frontend/src/i18n/tr.ts` `detail` section:

```ts
detail: {
  exception: 'İstisna',
  properties: 'Özellikler',
  rawJson: 'Ham JSON',
  trace: 'İz',
  viewTrace: 'İzi görüntüle',
},
```

6. `frontend/src/pages/EventsPage.tsx` — FilterBar can only be re-seeded by remounting (it copies `initialText` into state once), so add a seed key:

After the `searchText` state declaration, add:

```tsx
// FilterBar seeds its chip state from initialText once; bumping the key remounts it
// so a programmatic filter (View trace) shows up in the bar as well as the results
const [filterSeed, setFilterSeed] = useState(0)
function applyFilter(next: string) {
  setSearchText(next)
  setFilterSeed((seed) => seed + 1)
}
```

Change the FilterBar element (line ~171) to:

```tsx
<FilterBar key={filterSeed} initialText={searchText} onCommit={setSearchText} />
```

(`searchText` starts as `initialFilter`, so mount behavior is unchanged; later prop changes without a key bump are ignored by design.)

Change the EventDetail element to:

```tsx
<EventDetail
  event={selectedEvent}
  highlightTerms={highlightTerms}
  onClose={() => setSelectedEvent(undefined)}
  onViewTrace={(traceId) => applyFilter(`@TraceId = ${quote(traceId)}`)}
/>
```

and add `quote` to the import from `'../lib/filter'` (the file already imports `combineFilter` from there).

- [ ] **Step 4: Run the frontend suite and build**

Run (in `frontend/`): `npm run test` then `npm run build`
Expected: both PASS (build catches strict-TS errors in pages the tests don't cover).

- [ ] **Step 5: Update docs/frontend.md**

In the EventDetail description, add one sentence:

```
When the event carries a trace id, EventDetail shows it with a "View trace" button
that replaces the search filter with @TraceId = '<id>' (all events of that request).
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/filter.ts frontend/src/pages/AnalysisPage.tsx frontend/src/components/EventDetail.tsx frontend/src/components/EventDetail.test.tsx frontend/src/pages/EventsPage.tsx frontend/src/i18n/en.ts frontend/src/i18n/tr.ts docs/frontend.md
git commit -m "feat: show trace ids in EventDetail with View trace filter" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `dotnet test backend` — all green
- [ ] `npm run test` and `npm run build` in `frontend/` — all green
- [ ] Mark the four Phase 12-A items done (`[x]`) in todo.md
- [ ] Optional manual check (see the `verify` skill): ingest a CLEF line with `@tr`, open the event, click "View trace"
