# OTLP Traces Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest OTLP spans over `POST /v1/traces` into a `spans` table and render a real parent/child waterfall on the trace page, falling back to the log-inferred panel when a trace has no spans.

**Architecture:** Vendor the OTLP trace protos next to the logs ones; `OtlpTraceParser` maps spans to a `Span` record; `SqliteSpanStore` persists them and serves them by `trace_id`; `POST /v1/traces` mirrors `/v1/logs`; `GET /api/traces/{id}` feeds a new real-waterfall branch in the existing `TracePanel`. Age-based retention deletes old spans in the daily maintenance pass (no archive tiering).

**Tech Stack:** .NET 8 minimal API, Google.Protobuf + Grpc.Tools (build-time protoc), SQLite; React 18 + TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-otlp-traces-design.md`. Read before Task 1.

## Global Constraints

- Backend: nullable enabled, warnings as errors, async all the way, DTOs are records, parameterized SQL only, `Never SELECT *` (rules.md).
- OTLP proto files are vendored verbatim from open-telemetry/opentelemetry-proto **v1.10.0** (matching the existing logs protos); the `.csproj` already globs `Protos/**/*.proto`, so protoc picks them up with no build-file change.
- Span ids are lowercase W3C hex (trace 16 bytes → 32 hex, span 8 bytes → 16 hex). A span missing/short/all-zero `trace_id` or `span_id` is rejected; `MaxEventBytes` caps a single span; `MaxBatchBytes` caps the request.
- Spans are never archived; retention deletes spans older than `RetentionDays` regardless of the archive on/off setting.
- Frontend: TypeScript strict, no `any`; API calls only through `src/api/`; Tailwind, no per-component CSS; inline `style` only for computed values (bar positions, LEVEL_HEX); TR + EN i18n for new strings.
- All code/comments/commits in English; commit first lines imperative, ≤ 72 chars, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Commit straight to `main`.
- Backend commands run from repo root; frontend commands from `frontend/`.

---

### Task 1: Vendor trace protos + Span model + OtlpTraceParser

**Files:**
- Create: `backend/LogHarbor.Core/Protos/opentelemetry/proto/trace/v1/trace.proto` (vendored)
- Create: `backend/LogHarbor.Core/Protos/opentelemetry/proto/collector/trace/v1/trace_service.proto` (vendored)
- Create: `backend/LogHarbor.Core/Storage/Span.cs`
- Create: `backend/LogHarbor.Core/Events/Otlp/OtlpTraceParser.cs`
- Test: `backend/LogHarbor.Tests/Events/OtlpTraceParserTests.cs`

**Interfaces:**
- Consumes: `ClefParser.FormatTimestamp`, `ClefParser.ClampFuture`, `OtlpValues.ToJsonNode` (existing public helpers); generated OTLP types `OpenTelemetry.Proto.Collector.Trace.V1.ExportTraceServiceRequest`, `OpenTelemetry.Proto.Trace.V1.Span`.
- Produces (Tasks 2–5 rely on): `Span` positional record (below); `OtlpTraceParser.Parse(ExportTraceServiceRequest, DateTimeOffset serverTime, int maxSpanBytes)` → `OtlpTraceParseResult(IReadOnlyList<Span> Spans, long RejectedSpans, string? ErrorMessage)`.

- [ ] **Step 1: Vendor the two proto files from the pinned tag**

Run (from repo root; downloads the exact v1.10.0 files to the mirrored paths):

```bash
base=https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.10.0
mkdir -p backend/LogHarbor.Core/Protos/opentelemetry/proto/trace/v1
mkdir -p backend/LogHarbor.Core/Protos/opentelemetry/proto/collector/trace/v1
curl -fsS "$base/opentelemetry/proto/trace/v1/trace.proto" \
  -o backend/LogHarbor.Core/Protos/opentelemetry/proto/trace/v1/trace.proto
curl -fsS "$base/opentelemetry/proto/collector/trace/v1/trace_service.proto" \
  -o backend/LogHarbor.Core/Protos/opentelemetry/proto/collector/trace/v1/trace_service.proto
```

These files carry `option csharp_namespace = "OpenTelemetry.Proto.Trace.V1";` and
`"OpenTelemetry.Proto.Collector.Trace.V1";` upstream — no edits needed. They import
`common.proto` and `resource.proto`, already vendored.

- [ ] **Step 2: Verify the OTLP trace types generate**

Run: `dotnet build backend/LogHarbor.Core`
Expected: build succeeds; protoc generated the trace types. (Confirms the vendored files compile before any C# depends on them.)

- [ ] **Step 3: Add the Span record**

Create `backend/LogHarbor.Core/Storage/Span.cs`:

```csharp
namespace LogHarbor.Core.Storage;

/// <summary>One OTLP span. Ids are lowercase W3C hex; ParentSpanId is null for a root span.
/// StartTimestamp is UTC ISO-8601; DurationMs is (end - start) in milliseconds, 0 when unknown.
/// StatusCode is unset|ok|error; Attributes is a JSON object string or null.</summary>
public sealed record Span(
    long Id,
    string TraceId,
    string SpanId,
    string? ParentSpanId,
    string Name,
    string Kind,
    string? Service,
    string StartTimestamp,
    double DurationMs,
    string StatusCode,
    string? StatusMessage,
    string? Attributes,
    string IngestedAt);
```

- [ ] **Step 4: Write the failing parser test**

Create `backend/LogHarbor.Tests/Events/OtlpTraceParserTests.cs`:

```csharp
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Trace.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Resource.V1;
using OpenTelemetry.Proto.Trace.V1;
using LogHarbor.Core.Events.Otlp;

namespace LogHarbor.Tests.Events;

public class OtlpTraceParserTests
{
    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";
    private const string HexSpan = "b7ad6b7169203331";
    private const string HexParent = "1111222233334444";

    private static ExportTraceServiceRequest Request(Span span, string? serviceName = "checkout")
    {
        var scope = new ScopeSpans();
        scope.Spans.Add(span);
        var resourceSpans = new ResourceSpans();
        resourceSpans.ScopeSpans.Add(scope);
        if (serviceName is not null)
        {
            resourceSpans.Resource = new Resource();
            resourceSpans.Resource.Attributes.Add(
                new KeyValue { Key = "service.name", Value = new AnyValue { StringValue = serviceName } });
        }
        var request = new ExportTraceServiceRequest();
        request.ResourceSpans.Add(resourceSpans);
        return request;
    }

    [Fact]
    public void Span_IsMapped_WithServiceKindStatusAndDuration()
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            ParentSpanId = ByteString.CopyFrom(Convert.FromHexString(HexParent)),
            Name = "GET /cart",
            Kind = Span.Types.SpanKind.Server,
            StartTimeUnixNano = 1_000_000_000,   // 1s after epoch
            EndTimeUnixNano = 1_150_000_000,      // +150ms
            Status = new Status { Code = Status.Types.StatusCode.Error, Message = "boom" },
        };
        span.Attributes.Add(new KeyValue { Key = "http.method", Value = new AnyValue { StringValue = "GET" } });

        var result = OtlpTraceParser.Parse(Request(span), DateTimeOffset.UtcNow, maxSpanBytes: 262144);

        var mapped = Assert.Single(result.Spans);
        Assert.Equal(HexTrace, mapped.TraceId);
        Assert.Equal(HexSpan, mapped.SpanId);
        Assert.Equal(HexParent, mapped.ParentSpanId);
        Assert.Equal("GET /cart", mapped.Name);
        Assert.Equal("server", mapped.Kind);
        Assert.Equal("checkout", mapped.Service);
        Assert.Equal(150d, mapped.DurationMs);
        Assert.Equal("error", mapped.StatusCode);
        Assert.Equal("boom", mapped.StatusMessage);
        Assert.Contains("http.method", mapped.Attributes);
        Assert.Equal(0, result.RejectedSpans);
    }

    [Fact]
    public void RootSpan_HasNullParent_AndDefaults()
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            Name = "root",
            StartTimeUnixNano = 1_000_000_000,
            EndTimeUnixNano = 1_000_000_000,
        };

        var mapped = Assert.Single(OtlpTraceParser.Parse(Request(span), DateTimeOffset.UtcNow, 262144).Spans);
        Assert.Null(mapped.ParentSpanId);
        Assert.Equal(0d, mapped.DurationMs);
        Assert.Equal("unspecified", mapped.Kind);
        Assert.Equal("unset", mapped.StatusCode);
        Assert.Null(mapped.StatusMessage);
    }

    [Fact]
    public void SpanWithBadId_IsRejected_AndCounted()
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(new byte[] { 1, 2, 3 }), // wrong length
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            Name = "bad",
        };

        var result = OtlpTraceParser.Parse(Request(span, serviceName: null), DateTimeOffset.UtcNow, 262144);
        Assert.Empty(result.Spans);
        Assert.Equal(1, result.RejectedSpans);
    }
}
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `dotnet test backend --filter FullyQualifiedName~OtlpTraceParserTests`
Expected: FAIL to build — `OtlpTraceParser` does not exist yet.

- [ ] **Step 6: Implement the parser**

Create `backend/LogHarbor.Core/Events/Otlp/OtlpTraceParser.cs`:

```csharp
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Trace.V1;
using OpenTelemetry.Proto.Common.V1;
using System.Text.Json.Nodes;
using LogHarbor.Core.Storage;
using OtlpSpan = OpenTelemetry.Proto.Trace.V1.Span;
using SpanKind = OpenTelemetry.Proto.Trace.V1.Span.Types.SpanKind;
using StatusCode = OpenTelemetry.Proto.Trace.V1.Status.Types.StatusCode;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>The mapped spans plus what was dropped; feeds the OTLP partial_success response.</summary>
public sealed record OtlpTraceParseResult(
    IReadOnlyList<Span> Spans, long RejectedSpans, string? ErrorMessage);

/// <summary>Maps OTLP spans to Span rows (docs/ingestion-otlp.md). A span with no usable
/// trace/span id, or larger than MaxEventBytes, is rejected rather than stored.</summary>
public static class OtlpTraceParser
{
    private const string ServiceNameKey = "service.name";

    public static OtlpTraceParseResult Parse(
        ExportTraceServiceRequest request, DateTimeOffset serverTime, int maxSpanBytes)
    {
        var spans = new List<Span>();
        long rejected = 0;
        var ingestedAt = ClefParser.FormatTimestamp(serverTime);

        foreach (var resourceSpans in request.ResourceSpans)
        {
            var service = ResolveService(resourceSpans.Resource?.Attributes);
            foreach (var scopeSpans in resourceSpans.ScopeSpans)
            {
                foreach (var span in scopeSpans.Spans)
                {
                    var traceId = ToHexId(span.TraceId, 16);
                    var spanId = ToHexId(span.SpanId, 8);
                    if (traceId is null || spanId is null || span.CalculateSize() > maxSpanBytes)
                    {
                        rejected++;
                        continue;
                    }
                    spans.Add(MapSpan(span, traceId, spanId, service, serverTime, ingestedAt));
                }
            }
        }

        return new OtlpTraceParseResult(spans, rejected,
            rejected > 0
                ? $"{rejected} span(s) rejected (missing id or exceeded MaxEventBytes {maxSpanBytes})."
                : null);
    }

    private static Span MapSpan(
        OtlpSpan span, string traceId, string spanId, string? service,
        DateTimeOffset serverTime, string ingestedAt)
    {
        var attributes = new JsonObject();
        foreach (var attribute in span.Attributes)
        {
            attributes[attribute.Key] = OtlpValues.ToJsonNode(attribute.Value);
        }

        var duration = span.EndTimeUnixNano > span.StartTimeUnixNano
            ? (span.EndTimeUnixNano - span.StartTimeUnixNano) / 1_000_000.0
            : 0;

        return new Span(
            Id: 0,
            TraceId: traceId,
            SpanId: spanId,
            ParentSpanId: ToHexId(span.ParentSpanId, 8),
            Name: span.Name,
            Kind: MapKind(span.Kind),
            Service: service,
            StartTimestamp: ClefParser.FormatTimestamp(ResolveStart(span.StartTimeUnixNano, serverTime)),
            DurationMs: duration,
            StatusCode: MapStatus(span.Status?.Code),
            StatusMessage: string.IsNullOrEmpty(span.Status?.Message) ? null : span.Status!.Message,
            Attributes: attributes.Count > 0 ? attributes.ToJsonString() : null,
            IngestedAt: ingestedAt);
    }

    private static string MapKind(SpanKind kind) => kind switch
    {
        SpanKind.Internal => "internal",
        SpanKind.Server => "server",
        SpanKind.Client => "client",
        SpanKind.Producer => "producer",
        SpanKind.Consumer => "consumer",
        _ => "unspecified",
    };

    private static string MapStatus(StatusCode? code) => code switch
    {
        StatusCode.Ok => "ok",
        StatusCode.Error => "error",
        _ => "unset",
    };

    private static string? ResolveService(IEnumerable<KeyValue>? attributes)
    {
        if (attributes is null)
        {
            return null;
        }
        foreach (var attribute in attributes)
        {
            if (attribute.Key == ServiceNameKey
                && attribute.Value.ValueCase == AnyValue.ValueOneofCase.StringValue)
            {
                return attribute.Value.StringValue;
            }
        }
        return null;
    }

    /// <summary>Empty start clock falls back to the server clock; far-future clocks are clamped
    /// exactly like log timestamps.</summary>
    private static DateTimeOffset ResolveStart(ulong startNanos, DateTimeOffset serverTime)
    {
        if (startNanos == 0)
        {
            return serverTime;
        }
        var parsed = DateTimeOffset.UnixEpoch.AddTicks((long)(startNanos / 100));
        return ClefParser.ClampFuture(parsed, serverTime);
    }

    /// <summary>W3C ids are fixed-length and never all-zero; anything else is null (a null
    /// trace/span id rejects the span, a null parent id marks a root).</summary>
    private static string? ToHexId(ByteString id, int expectedLength)
    {
        if (id.Length != expectedLength)
        {
            return null;
        }
        var bytes = id.ToByteArray();
        return bytes.All(b => b == 0) ? null : Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `dotnet test backend --filter FullyQualifiedName~OtlpTraceParserTests`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/LogHarbor.Core/Protos/opentelemetry/proto/trace backend/LogHarbor.Core/Protos/opentelemetry/proto/collector/trace backend/LogHarbor.Core/Storage/Span.cs backend/LogHarbor.Core/Events/Otlp/OtlpTraceParser.cs backend/LogHarbor.Tests/Events/OtlpTraceParserTests.cs
git commit -m "feat(traces): vendor trace protos and map OTLP spans

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: spans table + SqliteSpanStore

**Files:**
- Create: `backend/LogHarbor.Api/Migrations/011_spans.sql`
- Create: `backend/LogHarbor.Core/Storage/ISpanStore.cs`
- Create: `backend/LogHarbor.Core/Storage/SqliteSpanStore.cs`
- Modify: `backend/LogHarbor.Api/Program.cs` (register `ISpanStore`)
- Modify: `docs/data-model.md` (spans table)
- Test: `backend/LogHarbor.Tests/Storage/SqliteSpanStoreTests.cs`

**Interfaces:**
- Consumes: `Span` (Task 1); `LogHarborDb.OpenConnection()`; `MigrationRunner.Apply` (tests).
- Produces (Tasks 3–4 rely on): `ISpanStore` with `Task WriteBatchAsync(IReadOnlyList<Span> spans, CancellationToken)`, `Task<IReadOnlyList<Span>> GetTraceAsync(string traceId, CancellationToken)`, `Task<long> DeleteSpansOlderThanAsync(string cutoffUtc, CancellationToken)`; `SqliteSpanStore(LogHarborDb db)`.

- [ ] **Step 1: Write the failing store test**

Create `backend/LogHarbor.Tests/Storage/SqliteSpanStoreTests.cs`:

```csharp
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Storage;

public sealed class SqliteSpanStoreTests : IDisposable
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"logharbor-spans-{Guid.NewGuid():N}.db");
    private readonly LogHarborDb _db;
    private readonly SqliteSpanStore _store;

    public SqliteSpanStoreTests()
    {
        _db = new LogHarborDb(_dbPath);
        MigrationRunner.Apply(_db, Path.Combine(AppContext.BaseDirectory, "Migrations"));
        _store = new SqliteSpanStore(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        File.Delete(_dbPath);
    }

    private static Span MakeSpan(string spanId, string start, string traceId = "aaaa", string? parent = null) => new(
        Id: 0, TraceId: traceId, SpanId: spanId, ParentSpanId: parent, Name: "op", Kind: "server",
        Service: "checkout", StartTimestamp: start, DurationMs: 12.5, StatusCode: "ok",
        StatusMessage: null, Attributes: null, IngestedAt: "2026-07-18T10:00:00.0000000Z");

    [Fact]
    public async Task GetTrace_ReturnsOnlyTheTrace_OrderedByStart()
    {
        await _store.WriteBatchAsync(
        [
            MakeSpan("s2", "2026-07-18T10:00:00.2000000Z"),
            MakeSpan("s1", "2026-07-18T10:00:00.1000000Z"),
            MakeSpan("other", "2026-07-18T10:00:00.1500000Z", traceId: "bbbb"),
        ]);

        var spans = await _store.GetTraceAsync("aaaa");

        Assert.Equal(2, spans.Count);
        Assert.Equal(["s1", "s2"], spans.Select(s => s.SpanId));
        Assert.Equal("checkout", spans[0].Service);
        Assert.Equal(12.5, spans[0].DurationMs);
    }

    [Fact]
    public async Task DeleteSpansOlderThan_RemovesOnlyOldRows()
    {
        await _store.WriteBatchAsync(
        [
            MakeSpan("old", "2026-07-10T10:00:00.0000000Z"),
            MakeSpan("new", "2026-07-18T10:00:00.0000000Z"),
        ]);

        var removed = await _store.DeleteSpansOlderThanAsync("2026-07-15T00:00:00.0000000Z");

        Assert.Equal(1, removed);
        Assert.Equal(["new"], (await _store.GetTraceAsync("aaaa")).Select(s => s.SpanId));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test backend --filter FullyQualifiedName~SqliteSpanStoreTests`
Expected: FAIL to build — `SqliteSpanStore`/`ISpanStore` and the `spans` table do not exist yet.

- [ ] **Step 3: Add the migration**

Create `backend/LogHarbor.Api/Migrations/011_spans.sql`:

```sql
-- 011: spans table for OTLP trace ingestion (docs/data-model.md). Trace-scoped reads only,
-- so no FTS; ix_spans_trace serves the waterfall and ix_spans_start serves retention.
-- Spans are never archived; retention deletes by start_timestamp age.

CREATE TABLE spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  service TEXT,
  start_timestamp TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  status_code TEXT NOT NULL,
  status_message TEXT,
  attributes TEXT,
  ingested_at TEXT NOT NULL
);

CREATE INDEX ix_spans_trace ON spans(trace_id);
CREATE INDEX ix_spans_start ON spans(start_timestamp);
```

- [ ] **Step 4: Add the store interface**

Create `backend/LogHarbor.Core/Storage/ISpanStore.cs`:

```csharp
namespace LogHarbor.Core.Storage;

public interface ISpanStore
{
    /// <summary>Writes all spans in one transaction; all or nothing.</summary>
    Task WriteBatchAsync(IReadOnlyList<Span> spans, CancellationToken cancellationToken = default);

    /// <summary>All spans of a trace, ordered by start_timestamp then id.</summary>
    Task<IReadOnlyList<Span>> GetTraceAsync(string traceId, CancellationToken cancellationToken = default);

    /// <summary>Deletes spans that started before cutoffUtc; returns the count removed.</summary>
    Task<long> DeleteSpansOlderThanAsync(string cutoffUtc, CancellationToken cancellationToken = default);
}
```

- [ ] **Step 5: Implement the store**

Create `backend/LogHarbor.Core/Storage/SqliteSpanStore.cs`:

```csharp
using Microsoft.Data.Sqlite;

namespace LogHarbor.Core.Storage;

public sealed class SqliteSpanStore : ISpanStore
{
    private const string Columns =
        "id, trace_id, span_id, parent_span_id, name, kind, service, " +
        "start_timestamp, duration_ms, status_code, status_message, attributes, ingested_at";

    private readonly LogHarborDb _db;

    public SqliteSpanStore(LogHarborDb db) => _db = db;

    public async Task WriteBatchAsync(
        IReadOnlyList<Span> spans, CancellationToken cancellationToken = default)
    {
        if (spans.Count == 0)
        {
            return;
        }

        using var connection = _db.OpenConnection();
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText =
            "INSERT INTO spans (trace_id, span_id, parent_span_id, name, kind, service, " +
            "start_timestamp, duration_ms, status_code, status_message, attributes, ingested_at) " +
            "VALUES (@traceId, @spanId, @parentSpanId, @name, @kind, @service, " +
            "@start, @duration, @statusCode, @statusMessage, @attributes, @ingestedAt);";

        var traceId = command.Parameters.Add("@traceId", SqliteType.Text);
        var spanId = command.Parameters.Add("@spanId", SqliteType.Text);
        var parentSpanId = command.Parameters.Add("@parentSpanId", SqliteType.Text);
        var name = command.Parameters.Add("@name", SqliteType.Text);
        var kind = command.Parameters.Add("@kind", SqliteType.Text);
        var service = command.Parameters.Add("@service", SqliteType.Text);
        var start = command.Parameters.Add("@start", SqliteType.Text);
        var duration = command.Parameters.Add("@duration", SqliteType.Real);
        var statusCode = command.Parameters.Add("@statusCode", SqliteType.Text);
        var statusMessage = command.Parameters.Add("@statusMessage", SqliteType.Text);
        var attributes = command.Parameters.Add("@attributes", SqliteType.Text);
        var ingestedAt = command.Parameters.Add("@ingestedAt", SqliteType.Text);

        foreach (var span in spans)
        {
            traceId.Value = span.TraceId;
            spanId.Value = span.SpanId;
            parentSpanId.Value = (object?)span.ParentSpanId ?? DBNull.Value;
            name.Value = span.Name;
            kind.Value = span.Kind;
            service.Value = (object?)span.Service ?? DBNull.Value;
            start.Value = span.StartTimestamp;
            duration.Value = span.DurationMs;
            statusCode.Value = span.StatusCode;
            statusMessage.Value = (object?)span.StatusMessage ?? DBNull.Value;
            attributes.Value = (object?)span.Attributes ?? DBNull.Value;
            ingestedAt.Value = span.IngestedAt;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Span>> GetTraceAsync(
        string traceId, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {Columns} FROM spans WHERE trace_id = @traceId ORDER BY start_timestamp, id;";
        command.Parameters.AddWithValue("@traceId", traceId);

        var spans = new List<Span>();
        using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            spans.Add(new Span(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.GetString(7),
                reader.GetDouble(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.GetString(12)));
        }
        return spans;
    }

    public async Task<long> DeleteSpansOlderThanAsync(
        string cutoffUtc, CancellationToken cancellationToken = default)
    {
        using var connection = _db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM spans WHERE start_timestamp < @cutoff;";
        command.Parameters.AddWithValue("@cutoff", cutoffUtc);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
```

- [ ] **Step 6: Register the store**

In `backend/LogHarbor.Api/Program.cs`, next to the other store registrations (after the `IArchiveStore` line):

```csharp
builder.Services.AddSingleton<ISpanStore, SqliteSpanStore>();
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `dotnet test backend --filter FullyQualifiedName~SqliteSpanStoreTests`
Expected: PASS (2 tests).

- [ ] **Step 8: Update the data-model docs**

In `docs/data-model.md`, add a short "SPANS" section describing the `spans` table (columns from the migration), that it is trace-scoped (indexed on `trace_id`), has no FTS, and is retained by `start_timestamp` age without archiving.

- [ ] **Step 9: Commit**

```bash
git add backend/LogHarbor.Api/Migrations/011_spans.sql backend/LogHarbor.Core/Storage/ISpanStore.cs backend/LogHarbor.Core/Storage/SqliteSpanStore.cs backend/LogHarbor.Api/Program.cs backend/LogHarbor.Tests/Storage/SqliteSpanStoreTests.cs docs/data-model.md
git commit -m "feat(traces): spans table and store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: POST /v1/traces ingestion endpoint

**Files:**
- Modify: `backend/LogHarbor.Core/Events/Otlp/OtlpJson.cs` (add a traces `TryParse`)
- Create: `backend/LogHarbor.Api/Endpoints/OtlpTraceEndpoints.cs`
- Modify: `backend/LogHarbor.Api/Program.cs` (`app.MapOtlpTraces()`)
- Modify: `docs/ingestion-otlp.md`, `docs/api.md` (INGESTION)
- Test: `backend/LogHarbor.Tests/Api/OtlpTraceEndpointsTests.cs`

**Interfaces:**
- Consumes: `OtlpTraceParser.Parse` (Task 1), `ISpanStore.WriteBatchAsync` (Task 2), `IngestionEndpoints.RateLimitPolicy`, `RequestBody.ReadCappedAsync`, `IngestionOptions`, `LogHarborMetrics.RecordIngestDuration`; generated `ExportTraceServiceRequest/Response`, `ExportTracePartialSuccess`.
- Produces: `POST /v1/traces`; `OtlpJson.TryParseTraces(string json, out ExportTraceServiceRequest? request, out string? error)`.

- [ ] **Step 1: Write the failing endpoint test**

Create `backend/LogHarbor.Tests/Api/OtlpTraceEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Google.Protobuf;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Proto.Collector.Trace.V1;
using OpenTelemetry.Proto.Trace.V1;

namespace LogHarbor.Tests.Api;

// ISpanStore is fully qualified below: importing LogHarbor.Core.Storage here would make the
// bare name `Span` ambiguous against OpenTelemetry.Proto.Trace.V1.Span.
public sealed class OtlpTraceEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public OtlpTraceEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";
    private const string HexSpan = "b7ad6b7169203331";

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "traces" });
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
    }

    private static ExportTraceServiceRequest OneSpan(string name)
    {
        var span = new Span
        {
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
            SpanId = ByteString.CopyFrom(Convert.FromHexString(HexSpan)),
            Name = name,
            StartTimeUnixNano = 1_000_000_000,
            EndTimeUnixNano = 1_050_000_000,
        };
        var scope = new ScopeSpans();
        scope.Spans.Add(span);
        var resourceSpans = new ResourceSpans();
        resourceSpans.ScopeSpans.Add(scope);
        var request = new ExportTraceServiceRequest();
        request.ResourceSpans.Add(resourceSpans);
        return request;
    }

    [Fact]
    public async Task Protobuf_IngestsSpans_AndPersistsThem()
    {
        var token = await CreateApiKeyAsync();
        var message = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new ByteArrayContent(OneSpan("GET /cart").ToByteArray()),
        };
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        message.Headers.Add("X-LogHarbor-ApiKey", token);

        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(message)).StatusCode);

        var spans = await _factory.Services
            .GetRequiredService<LogHarbor.Core.Storage.ISpanStore>().GetTraceAsync(HexTrace);
        Assert.Equal("GET /cart", Assert.Single(spans).Name);
    }

    [Fact]
    public async Task Json_IngestsSpans()
    {
        var token = await CreateApiKeyAsync();
        var json = $$"""
        {"resourceSpans":[{"scopeSpans":[{"spans":[
          {"traceId":"{{HexTrace}}","spanId":"{{HexSpan}}","name":"json-span",
           "startTimeUnixNano":"1000000000","endTimeUnixNano":"1050000000"}]}]}]}
        """;
        var message = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        message.Headers.Add("X-LogHarbor-ApiKey", token);

        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(message)).StatusCode);
        var spans = await _factory.Services
            .GetRequiredService<LogHarbor.Core.Storage.ISpanStore>().GetTraceAsync(HexTrace);
        Assert.Equal("json-span", Assert.Single(spans).Name);
    }

    [Fact]
    public async Task WrongContentType_Is415()
    {
        var token = await CreateApiKeyAsync();
        var message = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new StringContent("hi", Encoding.UTF8, "text/plain"),
        };
        message.Headers.Add("X-LogHarbor-ApiKey", token);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await _client.SendAsync(message)).StatusCode);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test backend --filter FullyQualifiedName~OtlpTraceEndpointsTests`
Expected: FAIL — `POST /v1/traces` is not mapped (404 / route missing), so the assertions fail to build or return 404.

- [ ] **Step 3: Add the traces JSON parser**

In `backend/LogHarbor.Core/Events/Otlp/OtlpJson.cs`, add a `using OpenTelemetry.Proto.Collector.Trace.V1;` at the top and this method (mirrors `TryParse`, walking spans instead of log records):

```csharp
    public static bool TryParseTraces(string json, out ExportTraceServiceRequest? request, out string? error)
    {
        request = null;
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(json);
        }
        catch (System.Text.Json.JsonException)
        {
            error = "invalid JSON";
            return false;
        }
        if (root is not JsonObject rootObject)
        {
            error = "payload must be a JSON object";
            return false;
        }

        try
        {
            RewriteSpanHexIds(rootObject);
            request = Parser.Parse<ExportTraceServiceRequest>(rootObject.ToJsonString());
        }
        catch (FormatException ex)
        {
            error = ex.Message;
            return false;
        }
        catch (InvalidProtocolBufferException ex)
        {
            error = ex.Message;
            return false;
        }

        error = null;
        return true;
    }

    private static void RewriteSpanHexIds(JsonObject root)
    {
        foreach (var resourceSpans in ArrayOf(root, "resourceSpans", "resource_spans"))
        {
            foreach (var scopeSpans in ArrayOf(resourceSpans, "scopeSpans", "scope_spans"))
            {
                foreach (var span in ArrayOf(scopeSpans, "spans", "spans"))
                {
                    RewriteId(span, "traceId", "trace_id");
                    RewriteId(span, "spanId", "span_id");
                    RewriteId(span, "parentSpanId", "parent_span_id");
                }
            }
        }
    }
```

(`ArrayOf` and `RewriteId` already exist and are reused unchanged.)

- [ ] **Step 4: Add the endpoint**

Create `backend/LogHarbor.Api/Endpoints/OtlpTraceEndpoints.cs`:

```csharp
using System.Text;
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Trace.V1;
using LogHarbor.Core.Events.Otlp;
using LogHarbor.Core.Storage;
using LogHarbor.Core.Telemetry;

namespace LogHarbor.Api.Endpoints;

/// <summary>
/// OTLP/HTTP trace ingestion (docs/ingestion-otlp.md). Standard /v1/traces path, protobuf and
/// JSON, so OTEL_EXPORTER_OTLP_ENDPOINT pointed at LogHarbor exports spans too. Same API-key
/// gate and rate limit as logs; spans are not broadcast to live tail (a log-only feature).
/// </summary>
public static class OtlpTraceEndpoints
{
    public static void MapOtlpTraces(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/traces", HandleAsync).RequireRateLimiting(IngestionEndpoints.RateLimitPolicy);
    }

    private static async Task<IResult> HandleAsync(
        HttpRequest httpRequest,
        ISpanStore spanStore,
        IngestionOptions options,
        CancellationToken cancellationToken)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var contentType = httpRequest.ContentType ?? "";
        var isProtobuf = contentType.StartsWith("application/x-protobuf", StringComparison.OrdinalIgnoreCase);
        var isJson = contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase);
        if (!isProtobuf && !isJson)
        {
            return Results.Problem(statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: "Unsupported content type",
                detail: "POST /v1/traces accepts application/x-protobuf or application/json.");
        }

        var body = await RequestBody.ReadCappedAsync(httpRequest, options.MaxBatchBytes, cancellationToken);
        if (body is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "Payload too large",
                detail: $"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }

        ExportTraceServiceRequest request;
        if (isProtobuf)
        {
            try
            {
                request = ExportTraceServiceRequest.Parser.ParseFrom(body);
            }
            catch (InvalidProtocolBufferException ex)
            {
                return BadRequest(ex.Message);
            }
        }
        else
        {
            if (!OtlpJson.TryParseTraces(Encoding.UTF8.GetString(body), out var parsed, out var error))
            {
                return BadRequest(error!);
            }
            request = parsed!;
        }

        var result = OtlpTraceParser.Parse(request, DateTimeOffset.UtcNow, options.MaxEventBytes);
        await spanStore.WriteBatchAsync(result.Spans, cancellationToken);
        LogHarborMetrics.RecordIngestDuration(
            System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds, "traces");

        var response = new ExportTraceServiceResponse();
        if (result.RejectedSpans > 0)
        {
            response.PartialSuccess = new ExportTracePartialSuccess
            {
                RejectedSpans = result.RejectedSpans,
                ErrorMessage = result.ErrorMessage ?? "",
            };
        }
        return isProtobuf
            ? Results.Bytes(response.ToByteArray(), "application/x-protobuf")
            : Results.Text(JsonFormatter.Default.Format(response), "application/json");
    }

    private static IResult BadRequest(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Invalid OTLP payload", detail: detail);
}
```

- [ ] **Step 5: Map the endpoint**

In `backend/LogHarbor.Api/Program.cs`, next to `app.MapOtlp();`:

```csharp
app.MapOtlpTraces();
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `dotnet test backend --filter FullyQualifiedName~OtlpTraceEndpointsTests`
Expected: PASS (3 tests).

- [ ] **Step 7: Update the ingestion docs**

In `docs/ingestion-otlp.md`, add a `/v1/traces` subsection: same API-key header and encodings as `/v1/logs`, spans stored in the `spans` table, viewable on the trace page. In `docs/api.md` INGESTION, add a `POST /v1/traces` line mirroring the `/v1/logs` entry (200 ExportTraceServiceResponse, partial_success on rejected spans, 400/401/413/415/429).

- [ ] **Step 8: Commit**

```bash
git add backend/LogHarbor.Core/Events/Otlp/OtlpJson.cs backend/LogHarbor.Api/Endpoints/OtlpTraceEndpoints.cs backend/LogHarbor.Api/Program.cs backend/LogHarbor.Tests/Api/OtlpTraceEndpointsTests.cs docs/ingestion-otlp.md docs/api.md
git commit -m "feat(traces): POST /v1/traces ingestion endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: GET /api/traces/{id} + span retention

**Files:**
- Create: `backend/LogHarbor.Api/Endpoints/TraceEndpoints.cs`
- Modify: `backend/LogHarbor.Api/Program.cs` (`app.MapTraces()`)
- Modify: `backend/LogHarbor.Api/Archiving/ArchiveScheduler.cs` (delete old spans daily)
- Modify: `docs/api.md` (a TRACES read section)
- Test: `backend/LogHarbor.Tests/Api/TraceEndpointsTests.cs`

**Interfaces:**
- Consumes: `ISpanStore.GetTraceAsync` / `DeleteSpansOlderThanAsync` (Task 2); `ISettingsStore.GetArchiveSettingsAsync` (for `RetentionDays`); `ClefParser.FormatTimestamp`.
- Produces: `GET /api/traces/{traceId}` → `{ spans: [...] }`.

- [ ] **Step 1: Write the failing read-endpoint test**

Create `backend/LogHarbor.Tests/Api/TraceEndpointsTests.cs`:

```csharp
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

public sealed class TraceEndpointsTests : IDisposable
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;

    public TraceEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task GetTrace_ReturnsSpans()
    {
        var store = _factory.Services.GetRequiredService<ISpanStore>();
        await store.WriteBatchAsync(
        [
            new Span(0, "aaaa", "s1", null, "root", "server", "checkout",
                "2026-07-18T10:00:00.0000000Z", 20, "ok", null, null, "2026-07-18T10:00:00.0000000Z"),
        ]);

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/traces/aaaa");

        var span = page.GetProperty("spans").EnumerateArray().Single();
        Assert.Equal("s1", span.GetProperty("spanId").GetString());
        Assert.Equal("root", span.GetProperty("name").GetString());
        Assert.Equal(20, span.GetProperty("durationMs").GetDouble());
    }

    [Fact]
    public async Task GetTrace_UnknownId_ReturnsEmpty()
    {
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/traces/nope");
        Assert.Empty(page.GetProperty("spans").EnumerateArray());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test backend --filter FullyQualifiedName~TraceEndpointsTests`
Expected: FAIL — `/api/traces/{id}` is not mapped (404).

- [ ] **Step 3: Add the read endpoint**

Create `backend/LogHarbor.Api/Endpoints/TraceEndpoints.cs`:

```csharp
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

/// <summary>Trace-scoped span read for the waterfall (docs/api.md TRACES). Session-gated,
/// read-only; unknown ids return an empty list rather than 404.</summary>
public static class TraceEndpoints
{
    public static void MapTraces(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/traces/{traceId}", async (
            string traceId, ISpanStore spanStore, CancellationToken cancellationToken) =>
        {
            var spans = await spanStore.GetTraceAsync(traceId, cancellationToken);
            return Results.Ok(new { spans });
        });
    }
}
```

- [ ] **Step 4: Map the endpoint**

In `backend/LogHarbor.Api/Program.cs`, next to `app.MapEvents();`:

```csharp
app.MapTraces();
```

- [ ] **Step 5: Run the read-endpoint test to verify it passes**

Run: `dotnet test backend --filter FullyQualifiedName~TraceEndpointsTests`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire span retention into the daily maintenance pass**

In `backend/LogHarbor.Api/Archiving/ArchiveScheduler.cs`, inject the span store and settings, and delete old spans in the daily branch. Change the constructor and fields:

```csharp
    private readonly Archiver _archiver;
    private readonly ISpanStore _spans;
    private readonly ISettingsStore _settings;
    private readonly ILogger<ArchiveScheduler> _logger;

    public ArchiveScheduler(
        Archiver archiver, ISpanStore spans, ISettingsStore settings, ILogger<ArchiveScheduler> logger)
    {
        _archiver = archiver;
        _spans = spans;
        _settings = settings;
        _logger = logger;
    }
```

Add `using LogHarbor.Core.Storage;` and `using LogHarbor.Core.Events;` at the top. In `RunOnceAsync`, inside the `if (today != lastArchiveDate)` block, after the retention line, add:

```csharp
                var retention = await _settings.GetArchiveSettingsAsync(stoppingToken);
                var spanCutoff = ClefParser.FormatTimestamp(now.AddDays(-retention.RetentionDays));
                var spansRemoved = await _spans.DeleteSpansOlderThanAsync(spanCutoff, stoppingToken);
                if (spansRemoved > 0)
                {
                    _logger.LogInformation("Retention removed {Count} span(s)", spansRemoved);
                }
```

(DI resolves the two new constructor parameters automatically — both are already registered singletons.)

- [ ] **Step 7: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS, no regressions (the scheduler still constructs under DI; tests disable its timed passes via `RunBackgroundJobs=false`).

- [ ] **Step 8: Update the API docs**

In `docs/api.md`, add a TRACES section: `GET /api/traces/{traceId}` → `{ spans: [ { traceId, spanId, parentSpanId, name, kind, service, startTimestamp, durationMs, statusCode, statusMessage, attributes } ] }`, session-gated, unknown id → empty list. Note spans are retained by `RetentionDays` and never archived.

- [ ] **Step 9: Commit**

```bash
git add backend/LogHarbor.Api/Endpoints/TraceEndpoints.cs backend/LogHarbor.Api/Program.cs backend/LogHarbor.Api/Archiving/ArchiveScheduler.cs backend/LogHarbor.Tests/Api/TraceEndpointsTests.cs docs/api.md
git commit -m "feat(traces): trace read endpoint and span retention

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Real waterfall in TracePanel

**Files:**
- Modify: `frontend/src/types/index.ts` (`SpanRecord`)
- Create: `frontend/src/api/traces.ts`
- Create: `frontend/src/hooks/useTrace.ts`
- Modify: `frontend/src/lib/trace.ts` (`buildSpanWaterfall`)
- Modify: `frontend/src/lib/trace.test.ts` (waterfall tests)
- Modify: `frontend/src/components/TracePanel.tsx` (real-waterfall branch)
- Modify: `frontend/src/components/TracePanel.test.tsx` (real-waterfall + fallback)
- Modify: `frontend/src/i18n/en.ts`, `frontend/src/i18n/tr.ts`
- Modify: `docs/frontend.md`

**Interfaces:**
- Consumes: `GET /api/traces/{id}` (Task 4); existing `useTraceEvents`, `buildTraceLayout`, `matchTraceFilter`, `LEVEL_HEX`, `Event` type.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing waterfall-logic test**

Add to `frontend/src/lib/trace.test.ts`:

```ts
import { buildSpanWaterfall } from './trace'
import type { SpanRecord } from '../types'

const TRACE = '0af7651916cd43dd8448eb211c80319c'

function makeSpan(overrides: Partial<SpanRecord>): SpanRecord {
  return {
    traceId: TRACE,
    spanId: 'x',
    parentSpanId: null,
    name: 'op',
    kind: 'server',
    service: 'checkout',
    startTimestamp: '2026-07-18T10:00:00.000Z',
    durationMs: 10,
    statusCode: 'unset',
    statusMessage: null,
    attributes: null,
    ...overrides,
  }
}

it('nests spans by parent and orders roots by start', () => {
  const layout = buildSpanWaterfall(
    [
      makeSpan({ spanId: 'child', parentSpanId: 'root', startTimestamp: '2026-07-18T10:00:00.050Z', durationMs: 20 }),
      makeSpan({ spanId: 'root', startTimestamp: '2026-07-18T10:00:00.000Z', durationMs: 200 }),
      makeSpan({ spanId: 'orphan', parentSpanId: 'missing', startTimestamp: '2026-07-18T10:00:00.100Z' }),
    ],
    [],
  )!

  expect(layout.rows.map((r) => [r.span.spanId, r.depth])).toEqual([
    ['root', 0],
    ['child', 1],
    ['orphan', 0], // parent not in the set -> treated as a root
  ])
  expect(layout.startMs).toBe(Date.parse('2026-07-18T10:00:00.000Z'))
})

it('attaches log events to their span and collects the rest as orphans', () => {
  const event = (id: number, spanId: string | null) => ({
    id, timestamp: '2026-07-18T10:00:00.010Z', level: 'Information' as const, message: 'm',
    messageTemplate: null, properties: null, exception: null, ingestedAt: '', traceId: TRACE, spanId,
  })
  const layout = buildSpanWaterfall(
    [makeSpan({ spanId: 'root' })],
    [event(1, 'root'), event(2, 'nope'), event(3, null)],
  )!

  expect(layout.rows[0].events.map((e) => e.id)).toEqual([1])
  expect(layout.orphanEvents.map((e) => e.id)).toEqual([2, 3])
})

it('returns null for no spans', () => {
  expect(buildSpanWaterfall([], [])).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/lib/trace.test.ts`
Expected: FAIL — `buildSpanWaterfall` and `SpanRecord` do not exist.

- [ ] **Step 3: Add the SpanRecord type**

In `frontend/src/types/index.ts`, add (near the other trace-related types):

```ts
/** One OTLP span from GET /api/traces/{id}; parentSpanId null for a root span. */
export interface SpanRecord {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  kind: string
  service: string | null
  startTimestamp: string
  durationMs: number
  statusCode: string
  statusMessage: string | null
  attributes: string | null
}
```

- [ ] **Step 4: Implement buildSpanWaterfall**

In `frontend/src/lib/trace.ts`, add (keep the existing `matchTraceFilter`/`buildTraceLayout` untouched; add the import for `SpanRecord`):

```ts
import type { Event, SpanRecord } from '../types'
```

```ts
/** One waterfall row: a span at a tree depth, plus the trace's log events on it. */
export interface SpanWaterfallRow {
  span: SpanRecord
  depth: number
  startMs: number
  endMs: number
  events: Event[]
}

export interface SpanWaterfall {
  rows: SpanWaterfallRow[]
  startMs: number
  endMs: number
  /** Log events whose spanId matches no span (or is null). */
  orphanEvents: Event[]
}

/**
 * Orders spans as a depth-first tree: roots (no parent, or a parent absent from the set)
 * first by start time, each followed by its children. Log events attach to the row whose
 * spanId matches; the rest are orphans. Returns null when there are no spans.
 */
export function buildSpanWaterfall(spans: SpanRecord[], events: Event[]): SpanWaterfall | null {
  if (spans.length === 0) return null

  const ids = new Set(spans.map((span) => span.spanId))
  const childrenOf = new Map<string, SpanRecord[]>()
  const roots: SpanRecord[] = []
  for (const span of spans) {
    const parent = span.parentSpanId
    if (parent !== null && ids.has(parent)) {
      const siblings = childrenOf.get(parent)
      if (siblings) siblings.push(span)
      else childrenOf.set(parent, [span])
    } else {
      roots.push(span)
    }
  }

  const byStart = (a: SpanRecord, b: SpanRecord) =>
    Date.parse(a.startTimestamp) - Date.parse(b.startTimestamp) || a.spanId.localeCompare(b.spanId)

  const eventsBySpan = new Map<string, Event[]>()
  const orphanEvents: Event[] = []
  for (const event of events) {
    if (event.spanId !== null && ids.has(event.spanId)) {
      const group = eventsBySpan.get(event.spanId)
      if (group) group.push(event)
      else eventsBySpan.set(event.spanId, [event])
    } else {
      orphanEvents.push(event)
    }
  }

  const rows: SpanWaterfallRow[] = []
  const seen = new Set<string>()
  const visit = (span: SpanRecord, depth: number) => {
    if (seen.has(span.spanId)) return // guard against a parent cycle
    seen.add(span.spanId)
    const startMs = Date.parse(span.startTimestamp)
    rows.push({
      span,
      depth,
      startMs,
      endMs: startMs + span.durationMs,
      events: eventsBySpan.get(span.spanId) ?? [],
    })
    for (const child of (childrenOf.get(span.spanId) ?? []).sort(byStart)) {
      visit(child, depth + 1)
    }
  }
  for (const root of roots.sort(byStart)) visit(root, 0)

  const startMs = Math.min(...rows.map((row) => row.startMs))
  const endMs = Math.max(...rows.map((row) => row.endMs))
  return { rows, startMs, endMs, orphanEvents }
}
```

- [ ] **Step 5: Run the logic test to verify it passes**

Run (from `frontend/`): `npx vitest run src/lib/trace.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the API client + hook**

Create `frontend/src/api/traces.ts`:

```ts
import { api } from './client'
import type { SpanRecord } from '../types'

export function getTrace(traceId: string): Promise<{ spans: SpanRecord[] }> {
  return api.get<{ spans: SpanRecord[] }>(`/api/traces/${encodeURIComponent(traceId)}`)
}
```

Create `frontend/src/hooks/useTrace.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { getTrace } from '../api/traces'

/** Real spans for a trace; empty when the trace has none (log-only senders). */
export function useTrace(traceId: string) {
  return useQuery({
    queryKey: ['trace-spans', traceId],
    queryFn: () => getTrace(traceId),
  })
}
```

- [ ] **Step 7: Write the failing TracePanel test**

Add to `frontend/src/components/TracePanel.test.tsx` (extend the existing mock: the panel now also calls `getTrace`). Change the `vi.mock('../api/events', ...)` block to also mock `../api/traces`, and add these tests:

```tsx
vi.mock('../api/traces', () => ({
  getTrace: vi.fn(async () => ({ spans: [] })),
}))
```

```tsx
import { getTrace } from '../api/traces'
```

```tsx
it('renders the real waterfall when the trace has spans', async () => {
  vi.mocked(getTrace).mockResolvedValue({
    spans: [
      {
        traceId: TRACE, spanId: 'root', parentSpanId: null, name: 'GET /cart', kind: 'server',
        service: 'checkout', startTimestamp: '2026-07-18T10:00:00.000Z', durationMs: 120,
        statusCode: 'error', statusMessage: 'boom', attributes: null,
      },
    ],
  })
  vi.mocked(getEvents).mockResolvedValue({ events: [], hasMore: false, archivedDays: [] })
  renderPanel()

  expect(await screen.findByText('GET /cart')).toBeDefined()
  expect(screen.getByText('120 ms')).toBeDefined()

  // clicking the span opens its detail with the status message
  screen.getByRole('button', { name: /GET \/cart/ }).click()
  expect(await screen.findByText(/error — boom/)).toBeDefined()
})

it('falls back to the inferred layout when the trace has no spans', async () => {
  vi.mocked(getTrace).mockResolvedValue({ spans: [] })
  vi.mocked(getEvents).mockResolvedValue({
    events: [makeEvent({ id: 1, spanId: 'b7ad6b7169203331', messageTemplate: 'inferred-op' })],
    hasMore: false,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('inferred-op')).toBeDefined()
})
```

- [ ] **Step 8: Run the TracePanel test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/TracePanel.test.tsx`
Expected: FAIL — the real waterfall is not rendered yet (the "GET /cart" span row is absent).

- [ ] **Step 9: Add the i18n strings**

In `frontend/src/i18n/en.ts`, inside the `trace` block, add:

```ts
    spanStatus: 'Status',
    spanKind: 'Kind',
    spanService: 'Service',
    spanAttributes: 'Attributes',
```

In `frontend/src/i18n/tr.ts`, inside the `trace` block, add:

```ts
    spanStatus: 'Durum',
    spanKind: 'Tür',
    spanService: 'Servis',
    spanAttributes: 'Öznitelikler',
```

- [ ] **Step 10: Render the real waterfall in TracePanel**

In `frontend/src/components/TracePanel.tsx` make four precise edits.

(a) Add imports near the existing ones:

```tsx
import { useState } from 'react'
import type { SpanRecord } from '../types'
import { useTrace } from '../hooks/useTrace'
import { buildSpanWaterfall } from '../lib/trace'
```

(b) Rename the existing `useTraceEvents` result from `trace` to `traceEvents`, add the spans query + waterfall memo + selected-span state, and REMOVE the early `if (!layout) return null` (it now lives after the waterfall branch). The top of the component becomes:

```tsx
export function TracePanel({ traceId, onSelectEvent }: TracePanelProps) {
  const { t, lang } = useI18n()
  const traceEvents = useTraceEvents(traceId)
  const spanQuery = useTrace(traceId)
  const layout = useMemo(() => buildTraceLayout(traceEvents.data?.events ?? []), [traceEvents.data])
  const waterfall = useMemo(
    () => buildSpanWaterfall(spanQuery.data?.spans ?? [], traceEvents.data?.events ?? []),
    [spanQuery.data, traceEvents.data],
  )
  const [selectedSpan, setSelectedSpan] = useState<SpanRecord | null>(null)
```

(c) In the existing inferred-layout render, change the one remaining `trace.data?.hasMore` reference to `traceEvents.data?.hasMore`, and add the early return right before `const totalMs` (so the inferred path only runs when there is no real waterfall and there is a layout):

```tsx
  if (waterfall) {
    return renderWaterfall()
  }
  if (!layout) return null
```

(d) Add the `renderWaterfall` helper as a nested function inside the component (before the `return`), rendering the real tree, log-dot overlay, and a click-to-open span detail:

```tsx
  function renderWaterfall() {
    const totalMs = Math.max(1, waterfall!.endMs - waterfall!.startMs)
    const percent = (ms: number) => `${((ms - waterfall!.startMs) / totalMs) * 100}%`
    return (
      <div className="shrink-0 border-b border-border bg-surface p-3">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-fg">{t.trace.title}</h2>
          <span className="truncate font-mono text-xs text-fg-muted" title={traceId}>{traceId}</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {waterfall!.rows.map((row) => (
            <div key={row.span.spanId} className="grid grid-cols-[minmax(10rem,20rem)_1fr_5rem] items-center gap-2 py-0.5">
              <button
                type="button"
                onClick={() => setSelectedSpan(row.span)}
                className="truncate text-left text-xs text-fg hover:text-accent"
                style={{ paddingLeft: `${row.depth * 12}px` }}
                title={`${row.span.name}${row.span.service ? ` — ${row.span.service}` : ''}`}
              >
                {row.span.service && <span className="mr-1 font-mono text-fg-muted">{row.span.service}</span>}
                {row.span.name}
              </button>
              <div className="relative h-4">
                <div
                  aria-hidden="true"
                  className="absolute top-1 h-2 rounded-sm opacity-40"
                  style={{
                    left: percent(row.startMs),
                    width: `${(row.span.durationMs / totalMs) * 100}%`,
                    backgroundColor: row.span.statusCode === 'error' ? LEVEL_HEX.Error : LEVEL_HEX.Information,
                  }}
                />
                {row.events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    aria-label={t.trace.dotAria(event.level, event.message)}
                    title={t.trace.dotAria(event.level, event.message)}
                    onClick={() => onSelectEvent(event)}
                    className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full border border-bg"
                    style={{ left: percent(Date.parse(event.timestamp)), backgroundColor: LEVEL_HEX[event.level] }}
                  />
                ))}
              </div>
              <span className="tabular text-right text-xs text-fg-muted">
                {`${Math.round(row.span.durationMs).toLocaleString(lang)} ms`}
              </span>
            </div>
          ))}
          {waterfall!.orphanEvents.length > 0 && (
            <div className="grid grid-cols-[minmax(10rem,20rem)_1fr_5rem] items-center gap-2 py-0.5">
              <span className="truncate text-xs text-fg-muted">{t.trace.noSpan}</span>
              <div className="relative h-4">
                {waterfall!.orphanEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    aria-label={t.trace.dotAria(event.level, event.message)}
                    title={t.trace.dotAria(event.level, event.message)}
                    onClick={() => onSelectEvent(event)}
                    className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full border border-bg"
                    style={{ left: percent(Date.parse(event.timestamp)), backgroundColor: LEVEL_HEX[event.level] }}
                  />
                ))}
              </div>
              <span />
            </div>
          )}
        </div>
        {selectedSpan && (
          <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5 border-t border-border pt-2 text-xs">
            <dt className="text-fg-muted">{t.trace.spanService}</dt><dd className="text-fg">{selectedSpan.service ?? '—'}</dd>
            <dt className="text-fg-muted">{t.trace.spanKind}</dt><dd className="text-fg">{selectedSpan.kind}</dd>
            <dt className="text-fg-muted">{t.trace.spanStatus}</dt>
            <dd className={selectedSpan.statusCode === 'error' ? 'text-level-error' : 'text-fg'}>
              {`${selectedSpan.statusCode}${selectedSpan.statusMessage ? ` — ${selectedSpan.statusMessage}` : ''}`}
            </dd>
            {selectedSpan.attributes && (
              <>
                <dt className="text-fg-muted">{t.trace.spanAttributes}</dt>
                <dd className="overflow-x-auto"><pre className="font-mono text-fg-muted">{selectedSpan.attributes}</pre></dd>
              </>
            )}
          </dl>
        )}
      </div>
    )
  }
```

- [ ] **Step 11: Run the TracePanel test + full suite + build**

Run (from `frontend/`): `npx vitest run` — Expected: PASS, all files.
Run (from `frontend/`): `npm run build` — Expected: tsc + vite succeed with no errors.

- [ ] **Step 12: Update the frontend docs + todo**

In `docs/frontend.md`, SERVICES/trace area: note that when the trace has real spans (`GET /api/traces/{id}`), the panel renders a real parent/child waterfall with actual durations and error-tinted bars, overlaying the trace's log events as dots on the matching span, and falls back to the log-inferred layout when a trace has no spans.

In `todo.md` (gitignored — no commit), mark the Phase 14 B "OTLP traces" line `[x]` with a DONE note pointing at the spec.

- [ ] **Step 13: Commit**

```bash
git add src/types/index.ts src/api/traces.ts src/hooks/useTrace.ts src/lib/trace.ts src/lib/trace.test.ts src/components/TracePanel.tsx src/components/TracePanel.test.tsx src/i18n/en.ts src/i18n/tr.ts ../docs/frontend.md
git commit -m "feat(traces): real span waterfall on the trace page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
