# OTLP Log Ingestion (Phase 12-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /v1/logs` accepts OTLP/HTTP log exports in BOTH protobuf and JSON encodings, so any OTel SDK or Collector ingests into LogHarbor by pointing `OTEL_EXPORTER_OTLP_ENDPOINT` at it — no Seq sink required.

**Architecture:** OTLP `.proto` files are vendored (pinned tag) and compiled at build time in LogHarbor.Core (`Google.Protobuf` runtime only, no gRPC stack). A new `OtlpLogParser` maps `LogRecord` → `Event` (severity ranges → six levels, `time_unix_nano` → the CLEF timestamp normalization, `message_template.text` → `message_template`, trace/span bytes → the Phase 12-A columns, attributes+resource → properties JSON). The endpoint reuses the entire existing pipeline: ApiKeyMiddleware, rate limiter, `WriteBatchAsync`, tail broadcast. OTLP attribute keys are dotted (`service.name`), so the query language gains dotted property identifiers (quoted JSON path steps) — done before the endpoint so its end-to-end test can filter on one.

**Tech Stack:** opentelemetry-proto **v1.10.0** (vendored), NuGet `Google.Protobuf` **3.35.1** (runtime), `Grpc.Tools` **2.82.0** (build-time, PrivateAssets=all). Everything else is existing: .NET 8, SQLite, xUnit.

## Global Constraints (rules.md + todo.md Phase 12-B)

- Nullable reference types + warnings-as-errors; async all the way; DTOs are records.
- Parameterized SQL only. The two pre-existing embed sites for `property` keep their API-boundary allowlist (extended to dots) and gain quoted JSON path steps.
- All code, comments, docs, commit messages in English; imperative commit subject ≤ 72 chars.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Backend tests: `dotnet test backend` (repo root). No frontend changes in this phase.
- Severity mapping (todo.md, verbatim): 1-4 Verbose, 5-8 Debug, 9-12 Information, 13-16 Warning, 17-20 Error, 21-24 Fatal; absent number → severity_text via existing level aliases → Information.
- Timestamps: `time_unix_nano` → same normalization as CLEF (UTC fixed format `yyyy-MM-ddTHH:mm:ss.fffffffZ`, future clamp 5 min); 0/absent → `observed_time_unix_nano`, then server time.
- Bad records → `partial_success` (rejected_log_records + error_message), never whole-batch 400. Whole-batch failures only for: unparseable body (400), unsupported content type (415), body > MaxBatchBytes (413).
- OTLP/JSON gotcha: trace_id/span_id are HEX in OTLP/JSON (spec deviation from proto3-JSON base64) — transcode before Google.Protobuf's JsonParser; covered by a test.
- Decisions locked here: record attributes win over resource attributes on key collision; `message_template.text` and `message_template.hash.md5` are consumed (not duplicated into properties); `exception.type/message/stacktrace` record attributes compose the `exception` column (`"{type}: {message}\n{stacktrace}"`) and are consumed; trace/span ids of wrong length or all-zero → null columns (record still stored); non-string bodies stored as their compact JSON text; dotted query identifiers mean the LITERAL flat property key (quoted JSON path step), not nesting.

## Ordering

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Tasks 2–5 build the Core parser stack on Task 1's generated types; Task 6 (dotted identifiers) is independent but must precede Task 7 so the endpoint test can filter by `service.name`; Task 8 is docs.

---

### Task 1: Vendor OTLP protos + build-time codegen

**Files:**
- Create: `backend/LogHarbor.Core/Protos/opentelemetry/proto/common/v1/common.proto`
- Create: `backend/LogHarbor.Core/Protos/opentelemetry/proto/resource/v1/resource.proto`
- Create: `backend/LogHarbor.Core/Protos/opentelemetry/proto/logs/v1/logs.proto`
- Create: `backend/LogHarbor.Core/Protos/opentelemetry/proto/collector/logs/v1/logs_service.proto`
- Modify: `backend/LogHarbor.Core/LogHarbor.Core.csproj`
- Test: `backend/LogHarbor.Tests/Events/OtlpProtoSmokeTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: generated C# types in `OpenTelemetry.Proto.Collector.Logs.V1` (`ExportLogsServiceRequest`, `ExportLogsServiceResponse`, `ExportLogsPartialSuccess`), `OpenTelemetry.Proto.Logs.V1` (`LogsData`, `ResourceLogs`, `ScopeLogs`, `LogRecord`, `SeverityNumber`), `OpenTelemetry.Proto.Common.V1` (`AnyValue`, `ArrayValue`, `KeyValueList`, `KeyValue`, `InstrumentationScope`), `OpenTelemetry.Proto.Resource.V1` (`Resource`). All later tasks use these.

- [ ] **Step 1: Download the four proto files at the pinned tag**

The directory layout must mirror the upstream import paths (`import "opentelemetry/proto/..."`), and `ProtoRoot` makes them resolve:

```bash
cd backend/LogHarbor.Core
mkdir -p Protos/opentelemetry/proto/common/v1 Protos/opentelemetry/proto/resource/v1 Protos/opentelemetry/proto/logs/v1 Protos/opentelemetry/proto/collector/logs/v1
BASE=https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.10.0/opentelemetry/proto
curl -fsSL "$BASE/common/v1/common.proto"                -o Protos/opentelemetry/proto/common/v1/common.proto
curl -fsSL "$BASE/resource/v1/resource.proto"            -o Protos/opentelemetry/proto/resource/v1/resource.proto
curl -fsSL "$BASE/logs/v1/logs.proto"                    -o Protos/opentelemetry/proto/logs/v1/logs.proto
curl -fsSL "$BASE/collector/logs/v1/logs_service.proto"  -o Protos/opentelemetry/proto/collector/logs/v1/logs_service.proto
grep -l "csharp_namespace" Protos/opentelemetry/proto/*/v1/*.proto Protos/opentelemetry/proto/collector/logs/v1/*.proto
```

Expected: all four files download; every file contains an `option csharp_namespace` line (that is where the `OpenTelemetry.Proto.*` namespaces come from).

- [ ] **Step 2: Wire codegen into LogHarbor.Core.csproj**

Full new content of `backend/LogHarbor.Core/LogHarbor.Core.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Google.Protobuf" Version="3.35.1" />
    <!-- build-time protoc only; GrpcServices=None below keeps the gRPC server stack out -->
    <PackageReference Include="Grpc.Tools" Version="2.82.0" PrivateAssets="all" />
    <PackageReference Include="Microsoft.Data.Sqlite" Version="10.0.9" />
  </ItemGroup>

  <ItemGroup>
    <!-- vendored from open-telemetry/opentelemetry-proto v1.10.0 -->
    <Protobuf Include="Protos\**\*.proto" ProtoRoot="Protos" GrpcServices="None" />
  </ItemGroup>

</Project>
```

- [ ] **Step 3: Write the smoke test**

Create `backend/LogHarbor.Tests/Events/OtlpProtoSmokeTests.cs`:

```csharp
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Logs.V1;

namespace LogHarbor.Tests.Events;

public sealed class OtlpProtoSmokeTests
{
    [Fact]
    public void GeneratedTypes_RoundTripThroughProtobuf()
    {
        var request = new ExportLogsServiceRequest();
        var resourceLogs = new ResourceLogs();
        resourceLogs.ScopeLogs.Add(new ScopeLogs());
        request.ResourceLogs.Add(resourceLogs);

        var parsed = ExportLogsServiceRequest.Parser.ParseFrom(request.ToByteArray());

        Assert.Single(parsed.ResourceLogs);
        Assert.Single(parsed.ResourceLogs[0].ScopeLogs);
    }
}
```

- [ ] **Step 4: Build and run the full suite**

Run: `dotnet test backend`
Expected: PASS — protoc generates the types during build; the smoke test proves they round-trip. If protoc fails on Windows, the error names the failing proto import — re-check the directory layout from Step 1.

- [ ] **Step 5: Commit**

```bash
git add backend/LogHarbor.Core/Protos backend/LogHarbor.Core/LogHarbor.Core.csproj backend/LogHarbor.Tests/Events/OtlpProtoSmokeTests.cs
git commit -m "feat: vendor OTLP protos (v1.10.0) with build-time codegen" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract shared level-alias and future-clamp helpers

**Files:**
- Modify: `backend/LogHarbor.Core/Events/Levels.cs`
- Modify: `backend/LogHarbor.Core/Events/ClefParser.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Levels.FromAlias(string? level) -> string` (canonical level; unknown/empty → "Information") and `ClefParser.ClampFuture(DateTimeOffset value, DateTimeOffset serverTime) -> DateTimeOffset`. Task 4 uses both. Pure refactor — behavior is already covered by `ClefParserTests.MapsLevelAliases_CaseInsensitively` and the future-clamp facts, which must stay green unchanged.

- [ ] **Step 1: Move the alias map into Levels**

`backend/LogHarbor.Core/Events/Levels.cs` — full new content:

```csharp
namespace LogHarbor.Core.Events;

/// <summary>The six canonical levels (docs/data-model.md), in severity order.</summary>
public static class Levels
{
    public static readonly IReadOnlyList<string> All =
        ["Verbose", "Debug", "Information", "Warning", "Error", "Fatal"];

    /// <summary>Maps ingestion level aliases (CLEF @l, OTLP severity_text) to the canonical six.
    /// Unknown or missing values become Information (docs/data-model.md).</summary>
    public static string FromAlias(string? level) => level?.Trim().ToLowerInvariant() switch
    {
        "verbose" or "trace" => "Verbose",
        "debug" => "Debug",
        "warning" or "warn" => "Warning",
        "error" or "err" => "Error",
        "fatal" or "critical" or "crit" => "Fatal",
        _ => "Information",
    };
}
```

- [ ] **Step 2: Point ClefParser at the shared helpers**

In `backend/LogHarbor.Core/Events/ClefParser.cs`:

1. Delete the private `MapLevel` method entirely and change its one call site:

```csharp
                Level: Levels.FromAlias(GetString(root, "@l")),
```

2. Replace the inline clamp in `TryParse`:

```csharp
            timestamp = ClampFuture(timestamp, serverTime);
```

(delete the old `if (timestamp > serverTime + FutureTolerance) { timestamp = serverTime; }` block including its comment) and add the public helper next to `FormatTimestamp`:

```csharp
    /// <summary>A client with a broken clock must not create rows that never age into the archive.</summary>
    public static DateTimeOffset ClampFuture(DateTimeOffset value, DateTimeOffset serverTime) =>
        value > serverTime + FutureTolerance ? serverTime : value;
```

- [ ] **Step 3: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS with zero test changes — this is a behavior-preserving refactor and the existing ClefParser facts are the safety net.

- [ ] **Step 4: Commit**

```bash
git add backend/LogHarbor.Core/Events/Levels.cs backend/LogHarbor.Core/Events/ClefParser.cs
git commit -m "refactor: share level aliases and future clamp for OTLP" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: OtlpValues — AnyValue trees to JSON

**Files:**
- Create: `backend/LogHarbor.Core/Events/Otlp/OtlpValues.cs`
- Test: `backend/LogHarbor.Tests/Events/OtlpValuesTests.cs`

**Interfaces:**
- Consumes: Task 1's `AnyValue`, `KeyValue` types.
- Produces: `OtlpValues.ToJsonNode(AnyValue? value) -> JsonNode?` and `OtlpValues.ToJsonObject(IEnumerable<KeyValue> values) -> JsonObject`. Task 4 uses both to build the properties column and stringify non-string bodies.

- [ ] **Step 1: Write the failing tests**

Create `backend/LogHarbor.Tests/Events/OtlpValuesTests.cs`:

```csharp
using Google.Protobuf;
using OpenTelemetry.Proto.Common.V1;
using LogHarbor.Core.Events.Otlp;

namespace LogHarbor.Tests.Events;

public sealed class OtlpValuesTests
{
    private static KeyValue Kv(string key, AnyValue value) => new() { Key = key, Value = value };

    [Fact]
    public void Scalars_MapToJsonEquivalents()
    {
        Assert.Equal("\"x\"", OtlpValues.ToJsonNode(new AnyValue { StringValue = "x" })!.ToJsonString());
        Assert.Equal("true", OtlpValues.ToJsonNode(new AnyValue { BoolValue = true })!.ToJsonString());
        Assert.Equal("42", OtlpValues.ToJsonNode(new AnyValue { IntValue = 42 })!.ToJsonString());
        Assert.Equal("1.5", OtlpValues.ToJsonNode(new AnyValue { DoubleValue = 1.5 })!.ToJsonString());
    }

    [Fact]
    public void Bytes_BecomeBase64Strings()
    {
        var value = new AnyValue { BytesValue = ByteString.CopyFrom([1, 2, 3]) };
        Assert.Equal("\"AQID\"", OtlpValues.ToJsonNode(value)!.ToJsonString());
    }

    [Fact]
    public void EmptyAnyValue_IsNull()
    {
        Assert.Null(OtlpValues.ToJsonNode(new AnyValue()));
        Assert.Null(OtlpValues.ToJsonNode(null));
    }

    [Fact]
    public void ArraysAndKvlists_NestRecursively()
    {
        var array = new AnyValue { ArrayValue = new ArrayValue() };
        array.ArrayValue.Values.Add(new AnyValue { IntValue = 1 });
        array.ArrayValue.Values.Add(new AnyValue { StringValue = "two" });

        var kvlist = new AnyValue { KvlistValue = new KeyValueList() };
        kvlist.KvlistValue.Values.Add(Kv("inner", array));

        Assert.Equal("""{"inner":[1,"two"]}""", OtlpValues.ToJsonNode(kvlist)!.ToJsonString());
    }

    [Fact]
    public void ToJsonObject_LastValueWins_OnDuplicateKeys()
    {
        var result = OtlpValues.ToJsonObject(
            [Kv("k", new AnyValue { IntValue = 1 }), Kv("k", new AnyValue { IntValue = 2 })]);

        Assert.Equal("""{"k":2}""", result.ToJsonString());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpValuesTests"`
Expected: FAIL to compile — `OtlpValues` does not exist.

- [ ] **Step 3: Implement**

Create `backend/LogHarbor.Core/Events/Otlp/OtlpValues.cs`:

```csharp
using System.Text.Json.Nodes;
using OpenTelemetry.Proto.Common.V1;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>Converts OTLP AnyValue/KeyValue trees to JSON for the properties column.</summary>
public static class OtlpValues
{
    public static JsonNode? ToJsonNode(AnyValue? value) => value?.ValueCase switch
    {
        AnyValue.ValueOneofCase.StringValue => JsonValue.Create(value.StringValue),
        AnyValue.ValueOneofCase.BoolValue => JsonValue.Create(value.BoolValue),
        AnyValue.ValueOneofCase.IntValue => JsonValue.Create(value.IntValue),
        AnyValue.ValueOneofCase.DoubleValue => JsonValue.Create(value.DoubleValue),
        AnyValue.ValueOneofCase.BytesValue => JsonValue.Create(value.BytesValue.ToBase64()),
        AnyValue.ValueOneofCase.ArrayValue => ToJsonArray(value.ArrayValue),
        AnyValue.ValueOneofCase.KvlistValue => ToJsonObject(value.KvlistValue.Values),
        // None or null: an empty AnyValue carries no information
        _ => null,
    };

    public static JsonObject ToJsonObject(IEnumerable<KeyValue> values)
    {
        var result = new JsonObject();
        foreach (var item in values)
        {
            // indexer, not Add: OTLP does not forbid duplicate keys, last one wins
            result[item.Key] = ToJsonNode(item.Value);
        }
        return result;
    }

    private static JsonArray ToJsonArray(ArrayValue array)
    {
        var result = new JsonArray();
        foreach (var item in array.Values)
        {
            result.Add(ToJsonNode(item));
        }
        return result;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass, then the full suite**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpValuesTests"` then `dotnet test backend`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add backend/LogHarbor.Core/Events/Otlp/OtlpValues.cs backend/LogHarbor.Tests/Events/OtlpValuesTests.cs
git commit -m "feat: convert OTLP AnyValue trees to JSON" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: OtlpLogParser — LogRecord to Event

**Files:**
- Create: `backend/LogHarbor.Core/Events/Otlp/OtlpLogParser.cs`
- Test: `backend/LogHarbor.Tests/Events/OtlpLogParserTests.cs`

**Interfaces:**
- Consumes: Task 1 types; `Levels.FromAlias`, `ClefParser.ClampFuture`, `ClefParser.FormatTimestamp` (Task 2); `OtlpValues` (Task 3).
- Produces: `OtlpParseResult(IReadOnlyList<Event> Events, long RejectedLogRecords, string? ErrorMessage)` and `OtlpLogParser.Parse(ExportLogsServiceRequest request, DateTimeOffset serverTime, int maxEventBytes) -> OtlpParseResult`. Task 7's endpoint calls this.

- [ ] **Step 1: Write the failing tests**

Create `backend/LogHarbor.Tests/Events/OtlpLogParserTests.cs`:

```csharp
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using LogHarbor.Core.Events;
using LogHarbor.Core.Events.Otlp;
using OtlpResource = OpenTelemetry.Proto.Resource.V1.Resource;

namespace LogHarbor.Tests.Events;

public sealed class OtlpLogParserTests
{
    private static readonly DateTimeOffset ServerTime =
        new(2026, 7, 13, 12, 0, 0, TimeSpan.Zero);

    private const int MaxEventBytes = 256 * 1024;

    // 2026-07-13T10:00:00Z in unix nanoseconds
    private const ulong TenAm = 1_783_936_800_000_000_000UL;

    private static KeyValue Attr(string key, string value) =>
        new() { Key = key, Value = new AnyValue { StringValue = value } };

    private static ExportLogsServiceRequest Wrap(LogRecord record, params KeyValue[] resourceAttributes)
    {
        var resourceLogs = new ResourceLogs { Resource = new OtlpResource() };
        resourceLogs.Resource.Attributes.AddRange(resourceAttributes);
        var scope = new ScopeLogs();
        scope.LogRecords.Add(record);
        resourceLogs.ScopeLogs.Add(scope);
        var request = new ExportLogsServiceRequest();
        request.ResourceLogs.Add(resourceLogs);
        return request;
    }

    private static Event ParseSingle(LogRecord record, params KeyValue[] resourceAttributes)
    {
        var result = OtlpLogParser.Parse(Wrap(record, resourceAttributes), ServerTime, MaxEventBytes);
        Assert.Equal(0, result.RejectedLogRecords);
        return Assert.Single(result.Events);
    }

    [Theory]
    [InlineData(1, "Verbose")]
    [InlineData(4, "Verbose")]
    [InlineData(5, "Debug")]
    [InlineData(9, "Information")]
    [InlineData(12, "Information")]
    [InlineData(13, "Warning")]
    [InlineData(17, "Error")]
    [InlineData(21, "Fatal")]
    [InlineData(24, "Fatal")]
    public void SeverityNumber_MapsToCanonicalLevel(int number, string expected)
    {
        var record = new LogRecord { TimeUnixNano = TenAm, SeverityNumber = (SeverityNumber)number };
        Assert.Equal(expected, ParseSingle(record).Level);
    }

    [Theory]
    [InlineData("warn", "Warning")]
    [InlineData("TRACE", "Verbose")]
    [InlineData("", "Information")]
    public void MissingSeverityNumber_FallsBackToSeverityText(string text, string expected)
    {
        var record = new LogRecord { TimeUnixNano = TenAm, SeverityText = text };
        Assert.Equal(expected, ParseSingle(record).Level);
    }

    [Fact]
    public void TimeUnixNano_IsNormalizedToFixedUtcFormat()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        Assert.Equal("2026-07-13T10:00:00.0000000Z", ParseSingle(record).Timestamp);
    }

    [Fact]
    public void ZeroTime_FallsBackToObservedTime_ThenServerTime()
    {
        var observed = new LogRecord { ObservedTimeUnixNano = TenAm };
        Assert.Equal("2026-07-13T10:00:00.0000000Z", ParseSingle(observed).Timestamp);

        var neither = new LogRecord();
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(neither).Timestamp);
    }

    [Fact]
    public void FarFutureTime_IsClampedToServerTime()
    {
        // one hour past server time, well beyond the 5-minute tolerance
        var record = new LogRecord { TimeUnixNano = TenAm + 3 * 3_600_000_000_000UL };
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(record).Timestamp);
    }

    [Fact]
    public void StringBody_BecomesMessage()
    {
        var record = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "hello otlp" } };
        Assert.Equal("hello otlp", ParseSingle(record).Message);
    }

    [Fact]
    public void StructuredBody_BecomesCompactJsonText()
    {
        var body = new AnyValue { KvlistValue = new KeyValueList() };
        body.KvlistValue.Values.Add(Attr("k", "v"));
        var record = new LogRecord { TimeUnixNano = TenAm, Body = body };
        Assert.Equal("""{"k":"v"}""", ParseSingle(record).Message);
    }

    [Fact]
    public void TemplateAttribute_BecomesMessageTemplate_AndIsConsumed()
    {
        var record = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "Order 42 failed" } };
        record.Attributes.Add(Attr("message_template.text", "Order {OrderId} failed"));
        record.Attributes.Add(Attr("message_template.hash.md5", "abc123"));
        record.Attributes.Add(new KeyValue { Key = "OrderId", Value = new AnyValue { IntValue = 42 } });

        var parsed = ParseSingle(record);

        Assert.Equal("Order {OrderId} failed", parsed.MessageTemplate);
        Assert.Equal("""{"OrderId":42}""", parsed.Properties);
    }

    [Fact]
    public void EmptyBody_FallsBackToTemplate()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("message_template.text", "tick {N}"));
        Assert.Equal("tick {N}", ParseSingle(record).Message);
    }

    [Fact]
    public void TraceAndSpanIds_BecomeLowercaseHex()
    {
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            TraceId = ByteString.CopyFrom(Convert.FromHexString("0AF7651916CD43DD8448EB211C80319C")),
            SpanId = ByteString.CopyFrom(Convert.FromHexString("B7AD6B7169203331")),
        };

        var parsed = ParseSingle(record);

        Assert.Equal("0af7651916cd43dd8448eb211c80319c", parsed.TraceId);
        Assert.Equal("b7ad6b7169203331", parsed.SpanId);
    }

    [Fact]
    public void InvalidIds_WrongLengthOrAllZero_BecomeNull()
    {
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            TraceId = ByteString.CopyFrom([1, 2, 3]),               // wrong length
            SpanId = ByteString.CopyFrom(new byte[8]),              // all-zero = invalid per W3C
        };

        var parsed = ParseSingle(record);

        Assert.Null(parsed.TraceId);
        Assert.Null(parsed.SpanId);
    }

    [Fact]
    public void ResourceAttributes_Merge_RecordWinsOnCollision()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("deployment.environment", "record-wins"));

        var parsed = ParseSingle(record,
            Attr("service.name", "checkout-api"),
            Attr("deployment.environment", "resource-loses"));

        Assert.Equal(
            """{"service.name":"checkout-api","deployment.environment":"record-wins"}""",
            parsed.Properties);
    }

    [Fact]
    public void ExceptionAttributes_ComposeExceptionColumn_AndAreConsumed()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("exception.type", "System.InvalidOperationException"));
        record.Attributes.Add(Attr("exception.message", "boom"));
        record.Attributes.Add(Attr("exception.stacktrace", "   at Api.Do()"));

        var parsed = ParseSingle(record);

        Assert.Equal("System.InvalidOperationException: boom\n   at Api.Do()", parsed.Exception);
        Assert.Null(parsed.Properties);
    }

    [Fact]
    public void NoAttributes_YieldNullPropertiesAndException()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        var parsed = ParseSingle(record);
        Assert.Null(parsed.Properties);
        Assert.Null(parsed.Exception);
    }

    [Fact]
    public void OversizedRecord_IsRejected_OthersSurvive()
    {
        var oversized = new LogRecord { TimeUnixNano = TenAm };
        oversized.Attributes.Add(Attr("blob", new string('x', MaxEventBytes + 1)));
        var normal = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "kept" } };

        var request = Wrap(oversized);
        request.ResourceLogs[0].ScopeLogs[0].LogRecords.Add(normal);

        var result = OtlpLogParser.Parse(request, ServerTime, MaxEventBytes);

        Assert.Equal(1, result.RejectedLogRecords);
        Assert.Contains("MaxEventBytes", result.ErrorMessage);
        Assert.Equal("kept", Assert.Single(result.Events).Message);
    }

    [Fact]
    public void IngestedAt_IsServerTime()
    {
        var record = new LogRecord { TimeUnixNano = TenAm };
        Assert.Equal("2026-07-13T12:00:00.0000000Z", ParseSingle(record).IngestedAt);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpLogParserTests"`
Expected: FAIL to compile — `OtlpLogParser`/`OtlpParseResult` do not exist.

- [ ] **Step 3: Implement**

Create `backend/LogHarbor.Core/Events/Otlp/OtlpLogParser.cs`:

```csharp
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using System.Text.Json.Nodes;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>The mapped batch plus what was dropped; feeds the OTLP partial_success response.</summary>
public sealed record OtlpParseResult(
    IReadOnlyList<Event> Events, long RejectedLogRecords, string? ErrorMessage);

/// <summary>Maps OTLP LogRecords to Events (docs/ingestion-otlp.md MAPPING).</summary>
public static class OtlpLogParser
{
    // Serilog.Sinks.OpenTelemetry carries the message template in these attributes; the text
    // becomes the message_template column (Analysis grouping), the hash adds nothing on top
    private const string TemplateAttribute = "message_template.text";
    private const string TemplateHashAttribute = "message_template.hash.md5";

    // OTel semantic conventions for exceptions on log records
    private const string ExceptionTypeAttribute = "exception.type";
    private const string ExceptionMessageAttribute = "exception.message";
    private const string ExceptionStacktraceAttribute = "exception.stacktrace";

    private static readonly ulong MaxTicksFromEpoch =
        (ulong)(DateTimeOffset.MaxValue.Ticks - DateTimeOffset.UnixEpoch.Ticks);

    public static OtlpParseResult Parse(
        ExportLogsServiceRequest request, DateTimeOffset serverTime, int maxEventBytes)
    {
        var events = new List<Event>();
        long rejected = 0;
        var ingestedAt = ClefParser.FormatTimestamp(serverTime);

        foreach (var resourceLogs in request.ResourceLogs)
        {
            foreach (var scopeLogs in resourceLogs.ScopeLogs)
            {
                foreach (var record in scopeLogs.LogRecords)
                {
                    if (record.CalculateSize() > maxEventBytes)
                    {
                        rejected++;
                        continue;
                    }
                    events.Add(MapRecord(record, resourceLogs.Resource?.Attributes, serverTime, ingestedAt));
                }
            }
        }

        return new OtlpParseResult(events, rejected,
            rejected > 0 ? $"{rejected} log record(s) exceeded MaxEventBytes ({maxEventBytes})." : null);
    }

    private static Event MapRecord(
        LogRecord record, IEnumerable<KeyValue>? resourceAttributes,
        DateTimeOffset serverTime, string ingestedAt)
    {
        var properties = new JsonObject();
        if (resourceAttributes is not null)
        {
            foreach (var attribute in resourceAttributes)
            {
                properties[attribute.Key] = OtlpValues.ToJsonNode(attribute.Value);
            }
        }

        string? messageTemplate = null;
        string? exceptionType = null;
        string? exceptionMessage = null;
        string? exceptionStacktrace = null;
        foreach (var attribute in record.Attributes)
        {
            switch (attribute.Key)
            {
                case TemplateAttribute when IsString(attribute.Value):
                    messageTemplate = attribute.Value.StringValue;
                    break;
                case TemplateHashAttribute:
                    break; // consumed: useless once the template text is a first-class column
                case ExceptionTypeAttribute when IsString(attribute.Value):
                    exceptionType = attribute.Value.StringValue;
                    break;
                case ExceptionMessageAttribute when IsString(attribute.Value):
                    exceptionMessage = attribute.Value.StringValue;
                    break;
                case ExceptionStacktraceAttribute when IsString(attribute.Value):
                    exceptionStacktrace = attribute.Value.StringValue;
                    break;
                default:
                    // record attributes win over resource attributes on key collision
                    properties[attribute.Key] = OtlpValues.ToJsonNode(attribute.Value);
                    break;
            }
        }

        var message = record.Body?.ValueCase switch
        {
            AnyValue.ValueOneofCase.StringValue => record.Body.StringValue,
            null or AnyValue.ValueOneofCase.None => messageTemplate ?? "",
            // structured bodies stay searchable as their JSON text
            _ => OtlpValues.ToJsonNode(record.Body)?.ToJsonString() ?? "",
        };

        return new Event(
            Id: 0,
            Timestamp: ClefParser.FormatTimestamp(ResolveTimestamp(record, serverTime)),
            Level: MapSeverity(record.SeverityNumber, record.SeverityText),
            Message: message,
            MessageTemplate: messageTemplate,
            Properties: properties.Count > 0 ? properties.ToJsonString() : null,
            Exception: ComposeException(exceptionType, exceptionMessage, exceptionStacktrace),
            IngestedAt: ingestedAt,
            TraceId: ToHexId(record.TraceId, 16),
            SpanId: ToHexId(record.SpanId, 8));
    }

    private static bool IsString(AnyValue? value) =>
        value?.ValueCase == AnyValue.ValueOneofCase.StringValue;

    /// <summary>1-24 severity blocks map onto the six canonical levels (todo.md Phase 12-B);
    /// 0/unspecified falls back to severity_text through the shared alias map.</summary>
    private static string MapSeverity(SeverityNumber number, string severityText) => (int)number switch
    {
        >= 1 and <= 4 => "Verbose",
        >= 5 and <= 8 => "Debug",
        >= 9 and <= 12 => "Information",
        >= 13 and <= 16 => "Warning",
        >= 17 and <= 20 => "Error",
        >= 21 and <= 24 => "Fatal",
        _ => Levels.FromAlias(severityText),
    };

    /// <summary>OTLP allows both timestamps to be empty: time, then observed time, then server clock.</summary>
    private static DateTimeOffset ResolveTimestamp(LogRecord record, DateTimeOffset serverTime)
    {
        var nanos = record.TimeUnixNano != 0 ? record.TimeUnixNano : record.ObservedTimeUnixNano;
        if (nanos == 0)
        {
            return serverTime;
        }
        var ticks = nanos / 100;
        // beyond year 9999 AddTicks would overflow; treat like any other broken clock
        var parsed = ticks > MaxTicksFromEpoch
            ? serverTime
            : DateTimeOffset.UnixEpoch.AddTicks((long)ticks);
        return ClefParser.ClampFuture(parsed, serverTime);
    }

    /// <summary>W3C ids are fixed-length and never all-zero; anything else stores as null
    /// rather than rejecting the record (docs/ingestion-otlp.md MAPPING).</summary>
    private static string? ToHexId(ByteString id, int expectedLength)
    {
        if (id.Length != expectedLength)
        {
            return null;
        }
        var bytes = id.ToByteArray();
        return bytes.All(b => b == 0) ? null : Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string? ComposeException(string? type, string? message, string? stacktrace)
    {
        // "{type}: {message}" matches .NET Exception.ToString(), so the Analysis page's
        // first-line-up-to-colon grouping works for OTLP events too
        var firstLine = (type, message) switch
        {
            (not null, not null) => $"{type}: {message}",
            (not null, null) => type,
            (null, not null) => message,
            _ => null,
        };
        if (firstLine is null)
        {
            return stacktrace;
        }
        return stacktrace is null ? firstLine : firstLine + "\n" + stacktrace;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass, then the full suite**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpLogParserTests"` then `dotnet test backend`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add backend/LogHarbor.Core/Events/Otlp/OtlpLogParser.cs backend/LogHarbor.Tests/Events/OtlpLogParserTests.cs
git commit -m "feat: map OTLP log records to events" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: OtlpJson — OTLP/JSON transcoding (the hex gotcha)

**Files:**
- Create: `backend/LogHarbor.Core/Events/Otlp/OtlpJson.cs`
- Test: `backend/LogHarbor.Tests/Events/OtlpJsonTests.cs`

**Interfaces:**
- Consumes: Task 1's `ExportLogsServiceRequest`.
- Produces: `OtlpJson.TryParse(string json, out ExportLogsServiceRequest? request, out string? error) -> bool`. Task 7's endpoint calls this for `application/json` bodies.

- [ ] **Step 1: Write the failing tests**

Create `backend/LogHarbor.Tests/Events/OtlpJsonTests.cs`:

```csharp
using LogHarbor.Core.Events.Otlp;

namespace LogHarbor.Tests.Events;

public sealed class OtlpJsonTests
{
    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";
    private const string HexSpan = "b7ad6b7169203331";

    // plain raw string + Replace: interpolated raw strings reject nested JSON's }} runs (CS9007)
    private static string Payload(string idFields) => """
        {"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}]},
        "scopeLogs":[{"logRecords":[{"timeUnixNano":"1783936800000000000","severityNumber":17,
        "body":{"stringValue":"boom"}__IDS__}]}]}]}
        """.Replace("__IDS__", idFields);

    [Fact]
    public void HexTraceIds_AreTranscoded_ForTheProtobufJsonParser()
    {
        var json = Payload($@",""traceId"":""{HexTrace}"",""spanId"":""{HexSpan}""");

        Assert.True(OtlpJson.TryParse(json, out var request, out var error), error);

        var record = request!.ResourceLogs[0].ScopeLogs[0].LogRecords[0];
        Assert.Equal(HexTrace, Convert.ToHexString(record.TraceId.ToByteArray()).ToLowerInvariant());
        Assert.Equal(HexSpan, Convert.ToHexString(record.SpanId.ToByteArray()).ToLowerInvariant());
        Assert.Equal("boom", record.Body.StringValue);
    }

    [Fact]
    public void SeverityNumber_AcceptsEnumNameStrings()
    {
        var json = """
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[
            {"severityNumber":"SEVERITY_NUMBER_ERROR","body":{"stringValue":"x"}}]}]}]}
            """;

        Assert.True(OtlpJson.TryParse(json, out var request, out var error), error);
        Assert.Equal(17, (int)request!.ResourceLogs[0].ScopeLogs[0].LogRecords[0].SeverityNumber);
    }

    [Fact]
    public void SnakeCaseKeys_AreAccepted()
    {
        var json = """
            {"resource_logs":[{"scope_logs":[{"log_records":[
            {"trace_id":"__TRACE__","body":{"stringValue":"x"}}]}]}]}
            """.Replace("__TRACE__", HexTrace);

        Assert.True(OtlpJson.TryParse(json, out var request, out var error), error);
        var record = request!.ResourceLogs[0].ScopeLogs[0].LogRecords[0];
        Assert.Equal(HexTrace, Convert.ToHexString(record.TraceId.ToByteArray()).ToLowerInvariant());
    }

    [Fact]
    public void UnknownFields_AreIgnored()
    {
        var json = """
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[
            {"body":{"stringValue":"x"},"someFutureField":123}]}]}]}
            """;

        Assert.True(OtlpJson.TryParse(json, out _, out var error), error);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    public void MalformedPayload_Fails(string json)
    {
        Assert.False(OtlpJson.TryParse(json, out _, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void NonHexTraceId_FailsWithFieldName()
    {
        var json = Payload(@",""traceId"":""zz-not-hex""");

        Assert.False(OtlpJson.TryParse(json, out _, out var error));
        Assert.Contains("traceId", error);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpJsonTests"`
Expected: FAIL to compile — `OtlpJson` does not exist.

- [ ] **Step 3: Implement**

Create `backend/LogHarbor.Core/Events/Otlp/OtlpJson.cs`:

```csharp
using System.Text.Json.Nodes;
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;

namespace LogHarbor.Core.Events.Otlp;

/// <summary>
/// Parses OTLP/JSON payloads. The OTLP spec encodes trace_id/span_id as HEX strings in JSON,
/// deviating from proto3 JSON (base64 for bytes), so those fields are transcoded to base64
/// before Google.Protobuf's JsonParser sees the document.
/// </summary>
public static class OtlpJson
{
    // collectors may send fields from newer proto revisions; ignoring them is forward compatibility
    private static readonly JsonParser Parser =
        new(JsonParser.Settings.Default.WithIgnoreUnknownFields(true));

    public static bool TryParse(string json, out ExportLogsServiceRequest? request, out string? error)
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
            RewriteHexIds(rootObject);
            request = Parser.Parse<ExportLogsServiceRequest>(rootObject.ToJsonString());
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

    private static void RewriteHexIds(JsonObject root)
    {
        foreach (var resourceLogs in ArrayOf(root, "resourceLogs", "resource_logs"))
        {
            foreach (var scopeLogs in ArrayOf(resourceLogs, "scopeLogs", "scope_logs"))
            {
                foreach (var record in ArrayOf(scopeLogs, "logRecords", "log_records"))
                {
                    RewriteId(record, "traceId", "trace_id");
                    RewriteId(record, "spanId", "span_id");
                }
            }
        }
    }

    // JsonParser accepts both camelCase and original snake_case field names; so must this walk
    private static IEnumerable<JsonObject> ArrayOf(JsonObject parent, string camel, string snake)
    {
        var array = parent[camel] as JsonArray ?? parent[snake] as JsonArray;
        if (array is null)
        {
            yield break;
        }
        foreach (var item in array)
        {
            if (item is JsonObject itemObject)
            {
                yield return itemObject;
            }
        }
    }

    private static void RewriteId(JsonObject record, string camel, string snake)
    {
        var key = record.ContainsKey(camel) ? camel : snake;
        if (record[key] is not JsonValue value || !value.TryGetValue<string>(out var hex))
        {
            return;
        }
        if (hex.Length == 0)
        {
            record.Remove(key);
            return;
        }
        byte[] bytes;
        try
        {
            bytes = Convert.FromHexString(hex);
        }
        catch (FormatException)
        {
            throw new FormatException($"{camel} must be a hex string");
        }
        record[key] = Convert.ToBase64String(bytes);
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass, then the full suite**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpJsonTests"` then `dotnet test backend`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add backend/LogHarbor.Core/Events/Otlp/OtlpJson.cs backend/LogHarbor.Tests/Events/OtlpJsonTests.cs
git commit -m "feat: parse OTLP/JSON with hex trace id transcoding" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Dotted property identifiers in the query language

OTLP attribute keys are dotted (`service.name`); without this task they are stored but unfilterable. Decision (Global Constraints): a dotted identifier names the LITERAL flat key — the JSON path step is quoted, so the dot is never interpreted as nesting.

**Files:**
- Modify: `backend/LogHarbor.Core/Query/QueryTokenizer.cs` (ScanIdentifier)
- Modify: `backend/LogHarbor.Core/Query/SqlTranslator.cs` (PropertyOperand + HasNode)
- Modify: `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` (the two `$.{property}` embed sites)
- Modify: `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs` (two property allowlists)
- Modify: `docs/query-language.md`
- Test: `backend/LogHarbor.Tests/Query/SqlTranslatorTests.cs`, `backend/LogHarbor.Tests/Storage/SqliteEventStoreTests.cs`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent).
- Produces: filters like `service.name = 'checkout-api'` and `Has(http.route)` translate to `json_extract(properties, '$."service.name"') = @q0` / `json_type(properties, '$."http.route"') IS NOT NULL`. Task 7's endpoint test filters on `service.name`.

- [ ] **Step 1: Write the failing tests**

In `backend/LogHarbor.Tests/Query/SqlTranslatorTests.cs`, add:

```csharp
    [Fact]
    public void DottedProperty_UsesQuotedJsonPathStep()
    {
        var result = Translate("service.name = 'checkout-api'");

        Assert.Equal("json_extract(properties, '$.\"service.name\"') = @q0", result.Sql);
        Assert.Equal(Pairs(Pair("@q0", "checkout-api")), result.Parameters);
    }

    [Fact]
    public void Has_WithDottedProperty_UsesQuotedJsonPathStep()
    {
        Assert.Equal("json_type(properties, '$.\"http.route\"') IS NOT NULL",
            Translate("Has(http.route)").Sql);
    }
```

In `backend/LogHarbor.Tests/Storage/SqliteEventStoreTests.cs`, add:

```csharp
    [Fact]
    public async Task PropertyValues_WithDottedKey_GroupsTheFlatKey()
    {
        await _store.WriteBatchAsync([MakeEvent(properties: """{"service.name":"checkout"}""")]);

        var rows = await _store.GetPropertyValuesAsync(
            null, "2026-07-13T00:00:00.0000000Z", "2026-07-13T23:59:59.9999999Z", "service.name", 10);

        var row = Assert.Single(rows);
        Assert.Equal("checkout", row.Value);
        Assert.Equal(1L, row.Count);
    }
```

(If `PropertyValueCount`'s members differ from `Value`/`Count`, check `backend/LogHarbor.Core/Storage/IEventStore.cs` and use its exact names.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~SqlTranslatorTests|FullyQualifiedName~SqliteEventStoreTests"`
Expected: the two translator facts FAIL with `unexpected character '.'` (tokenizer); the store fact FAILS with an empty result — the unquoted `$.service.name` path reads the dot as nesting and finds nothing.

- [ ] **Step 3: Implement**

1. `backend/LogHarbor.Core/Query/QueryTokenizer.cs` — `ScanIdentifier` accepts dots (identifiers still cannot START with a dot or digit; those branches are untouched):

```csharp
    private static string ScanIdentifier(string input, ref int i)
    {
        var start = i;
        // '.' joins OTLP-style attribute keys (service.name); it names a literal flat key
        while (i < input.Length && (char.IsAsciiLetterOrDigit(input[i]) || input[i] == '_' || input[i] == '.'))
        {
            i++;
        }
        return input[start..i];
    }
```

2. `backend/LogHarbor.Core/Query/SqlTranslator.cs` — quote the JSON path step in both property sites:

```csharp
        // json_type is NULL only when the path is absent, so a property holding JSON null still counts as present
        HasNode n => $"json_type(properties, '$.\"{n.Property}\"') IS NOT NULL",
```

```csharp
        // safe to embed: the tokenizer restricts identifiers to [A-Za-z0-9_.]; the quoted
        // path step makes a dot part of the key, never a nesting separator
        PropertyOperand p => $"json_extract(properties, '$.\"{p.Name}\"')",
```

3. `backend/LogHarbor.Core/Storage/SqliteEventStore.cs` — both embed sites get the same quoted step. In `GetSlowOperationsAsync`:

```csharp
        // safe to embed: property is restricted to [A-Za-z0-9_.] at the API boundary;
        // the quoted step keeps dots literal
        var extract = $"json_extract(properties, '$.\"{property}\"')";
```

and the identical two lines in `GetPropertyValuesAsync` (replace its existing `var extract = ...` and comment).

4. `backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs` — both validation sites (lines ~84 and ~113) become:

```csharp
        if (property.Length == 0 || !property.All(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '.'))
        {
            return BadRequest("Invalid query", "property must contain only letters, digits, underscores, or dots.");
        }
```

5. Update every existing `SqlTranslatorTests` expectation that contains an unquoted `$.` path to the quoted form — known ones: `PropertyComparison_UsesJsonExtract` (`'$."UserId"'`), `Like_PassesPatternThroughUnescaped` (`'$."RequestPath"'`), `SqlFor_RoutesFreeTextToTheGivenFtsTable` (`'$."UserId"'` and `'$."events_fts"'`), the `NullComparison_BecomesIsNull` theory (`'$."OrderId"'`). Run the suite; fix any remaining expectation the failures name (the failure output prints both strings).

- [ ] **Step 4: Run the full backend suite**

Run: `dotnet test backend`
Expected: PASS — including every updated expectation.

- [ ] **Step 5: Update docs/query-language.md**

In PROPERTY ACCESS, extend the bare-identifier paragraph:

```
Bare identifier refers to a structured property:
  UserId, RequestPath, OrderId
Dots are allowed and name the literal flat key (OTLP attribute style):
  service.name, http.route  ->  json_extract(properties, '$."service.name"')
  (a dot never means nesting; the JSON path step is quoted)
```

In SQL TRANSLATION EXAMPLES, update the `UserId = 42` example's SQL to `json_extract(properties, '$."UserId"') = @p0`.

- [ ] **Step 6: Commit**

```bash
git add backend/LogHarbor.Core/Query/QueryTokenizer.cs backend/LogHarbor.Core/Query/SqlTranslator.cs backend/LogHarbor.Core/Storage/SqliteEventStore.cs backend/LogHarbor.Api/Endpoints/StatsEndpoints.cs backend/LogHarbor.Tests/Query/SqlTranslatorTests.cs backend/LogHarbor.Tests/Storage/SqliteEventStoreTests.cs docs/query-language.md
git commit -m "feat: allow dotted property identifiers in filters" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: POST /v1/logs endpoint

**Files:**
- Create: `backend/LogHarbor.Api/Endpoints/OtlpEndpoints.cs`
- Create: `backend/LogHarbor.Api/Endpoints/RequestBody.cs`
- Modify: `backend/LogHarbor.Api/Endpoints/IngestionEndpoints.cs` (use the shared body reader)
- Modify: `backend/LogHarbor.Api/Program.cs` (ApiKeyMiddleware path, MapOtlp, /v1 fallback 404)
- Test: `backend/LogHarbor.Tests/Api/OtlpEndpointsTests.cs`

**Interfaces:**
- Consumes: `OtlpLogParser.Parse(request, serverTime, maxEventBytes)` (Task 4), `OtlpJson.TryParse` (Task 5), dotted filters (Task 6), existing `IEventStore.WriteBatchAsync`, `TailBroadcaster.BroadcastAsync`, `IngestionOptions`, `IngestionEndpoints.RateLimitPolicy`.
- Produces: `POST /v1/logs` accepting `application/x-protobuf` and `application/json`, gated by ApiKeyMiddleware, responding `ExportLogsServiceResponse` in the request's encoding; unknown `/v1/*` paths 404 instead of serving the SPA.

- [ ] **Step 1: Write the failing tests**

Create `backend/LogHarbor.Tests/Api/OtlpEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Google.Protobuf;
using Microsoft.AspNetCore.SignalR.Client;
using OpenTelemetry.Proto.Collector.Logs.V1;
using OpenTelemetry.Proto.Common.V1;
using OpenTelemetry.Proto.Logs.V1;
using LogHarbor.Core.Events;
using OtlpResource = OpenTelemetry.Proto.Resource.V1.Resource;

namespace LogHarbor.Tests.Api;

public sealed class OtlpEndpointsTests : IAsyncLifetime
{
    private const string HexTrace = "0af7651916cd43dd8448eb211c80319c";

    // 2026-07-13T10:00:00Z in unix nanoseconds
    private const ulong TenAm = 1_783_936_800_000_000_000UL;

    private readonly LogHarborApiFactory _factory = new();
    private readonly HttpClient _client;
    private readonly List<HubConnection> _connections = [];

    public OtlpEndpointsTests() => _client = _factory.CreateClient();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var connection in _connections)
        {
            await connection.DisposeAsync();
        }
        _factory.Dispose();
    }

    private async Task<string> CreateApiKeyAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/apikeys", new { title = "otlp" });
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        return created.GetProperty("token").GetString()!;
    }

    private Task<HttpResponseMessage> PostOtlpAsync(byte[] body, string contentType, string? apiKey)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/logs")
        {
            Content = new ByteArrayContent(body),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        if (apiKey is not null)
        {
            request.Headers.Add("X-LogHarbor-ApiKey", apiKey);
        }
        return _client.SendAsync(request);
    }

    private static KeyValue Attr(string key, string value) =>
        new() { Key = key, Value = new AnyValue { StringValue = value } };

    private static ExportLogsServiceRequest BuildRequest(params LogRecord[] records)
    {
        var resourceLogs = new ResourceLogs { Resource = new OtlpResource() };
        resourceLogs.Resource.Attributes.Add(Attr("service.name", "checkout-api"));
        var scope = new ScopeLogs();
        scope.LogRecords.AddRange(records);
        resourceLogs.ScopeLogs.Add(scope);
        var request = new ExportLogsServiceRequest();
        request.ResourceLogs.Add(resourceLogs);
        return request;
    }

    [Fact]
    public async Task MissingApiKey_Returns401()
    {
        var response = await PostOtlpAsync(
            BuildRequest(new LogRecord()).ToByteArray(), "application/x-protobuf", apiKey: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtobufBatch_IsStored_AndQueryableByDottedProperty()
    {
        var token = await CreateApiKeyAsync();
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            SeverityNumber = (SeverityNumber)17,
            Body = new AnyValue { StringValue = "otlp boom" },
            TraceId = ByteString.CopyFrom(Convert.FromHexString(HexTrace)),
        };

        var response = await PostOtlpAsync(BuildRequest(record).ToByteArray(), "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/x-protobuf", response.Content.Headers.ContentType!.MediaType);
        var export = ExportLogsServiceResponse.Parser.ParseFrom(await response.Content.ReadAsByteArrayAsync());
        Assert.Null(export.PartialSuccess);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/events?filter=" + Uri.EscapeDataString("service.name = 'checkout-api'"));
        var matched = page.GetProperty("events").EnumerateArray().Single();
        Assert.Equal("otlp boom", matched.GetProperty("message").GetString());
        Assert.Equal("Error", matched.GetProperty("level").GetString());
        Assert.Equal(HexTrace, matched.GetProperty("traceId").GetString());
    }

    [Fact]
    public async Task JsonBatch_WithHexTraceIds_IsStored()
    {
        var token = await CreateApiKeyAsync();
        var json = $$"""
            {"resourceLogs":[{"scopeLogs":[{"logRecords":[
            {"timeUnixNano":"{{TenAm}}","severityNumber":"SEVERITY_NUMBER_WARN",
            "body":{"stringValue":"json otlp"},"traceId":"{{HexTrace}}"}]}]}]}
            """;

        var response = await PostOtlpAsync(Encoding.UTF8.GetBytes(json), "application/json", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/events?filter=" + Uri.EscapeDataString($"@TraceId = '{HexTrace}'"));
        var matched = page.GetProperty("events").EnumerateArray().Single();
        Assert.Equal("json otlp", matched.GetProperty("message").GetString());
        Assert.Equal("Warning", matched.GetProperty("level").GetString());
    }

    [Fact]
    public async Task OversizedRecord_IsSkipped_AndReportedInPartialSuccess()
    {
        var token = await CreateApiKeyAsync();
        var oversized = new LogRecord { TimeUnixNano = TenAm };
        oversized.Attributes.Add(Attr("blob", new string('x', 300 * 1024)));
        var normal = new LogRecord { TimeUnixNano = TenAm, Body = new AnyValue { StringValue = "kept" } };

        var response = await PostOtlpAsync(
            BuildRequest(oversized, normal).ToByteArray(), "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var export = ExportLogsServiceResponse.Parser.ParseFrom(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(1, export.PartialSuccess.RejectedLogRecords);
        Assert.Contains("MaxEventBytes", export.PartialSuccess.ErrorMessage);

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/events");
        Assert.Equal(1, page.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task UnsupportedContentType_Returns415()
    {
        var token = await CreateApiKeyAsync();
        var response = await PostOtlpAsync([1, 2, 3], "text/plain", token);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task MalformedProtobuf_Returns400()
    {
        var token = await CreateApiKeyAsync();
        var response = await PostOtlpAsync([0xFF, 0xFF, 0xFF, 0xFF], "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task BatchOverMaxBatchBytes_Returns413()
    {
        var token = await CreateApiKeyAsync();
        var record = new LogRecord { TimeUnixNano = TenAm };
        record.Attributes.Add(Attr("blob", new string('x', 6 * 1024 * 1024)));

        var response = await PostOtlpAsync(BuildRequest(record).ToByteArray(), "application/x-protobuf", token);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task UnknownV1Path_Returns404_NotTheSpa()
    {
        var token = await CreateApiKeyAsync();
        var response = await PostOtlpAsync(
            BuildRequest(new LogRecord()).ToByteArray(), "application/x-protobuf", token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/traces")
        {
            Content = new ByteArrayContent([]),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        request.Headers.Add("X-LogHarbor-ApiKey", token);
        var traces = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, traces.StatusCode);
    }

    [Fact]
    public async Task LiveTail_ReceivesOtlpEvents_MatchingFilter()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(_factory.Server.BaseAddress, "hubs/tail"),
                options => options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler())
            .Build();
        _connections.Add(connection);
        var batches = Channel.CreateUnbounded<IReadOnlyList<Event>>();
        connection.On<IReadOnlyList<Event>>("EventsArrived", events => batches.Writer.TryWrite(events));
        await connection.StartAsync();
        await connection.InvokeAsync("Subscribe", "@Level = 'Error'");

        var token = await CreateApiKeyAsync();
        var record = new LogRecord
        {
            TimeUnixNano = TenAm,
            SeverityNumber = (SeverityNumber)17,
            Body = new AnyValue { StringValue = "tail me" },
        };
        (await PostOtlpAsync(BuildRequest(record).ToByteArray(), "application/x-protobuf", token))
            .EnsureSuccessStatusCode();

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var received = await batches.Reader.ReadAsync(timeout.Token);
        Assert.Equal("tail me", Assert.Single(received).Message);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpEndpointsTests"`
Expected: FAIL — every request to `/v1/logs` returns 404 (endpoint does not exist yet). (`MissingApiKey_Returns401` also fails: the middleware is not on the path yet.)

- [ ] **Step 3: Implement the shared body reader**

Create `backend/LogHarbor.Api/Endpoints/RequestBody.cs`:

```csharp
namespace LogHarbor.Api.Endpoints;

internal static class RequestBody
{
    /// <summary>Reads at most maxBytes; returns null when the body is larger (chunked bodies have no Content-Length).</summary>
    public static async Task<byte[]?> ReadCappedAsync(
        HttpRequest request, int maxBytes, CancellationToken cancellationToken)
    {
        if (request.ContentLength > maxBytes)
        {
            return null;
        }
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > maxBytes)
            {
                return null;
            }
        }
        return buffer.ToArray();
    }
}
```

In `backend/LogHarbor.Api/Endpoints/IngestionEndpoints.cs`: delete the private `ReadBodyCappedAsync` method and the now-unneeded Content-Length pre-check, and change `HandleAsync`'s body acquisition to:

```csharp
        var bytes = await RequestBody.ReadCappedAsync(request, options.MaxBatchBytes, cancellationToken);
        if (bytes is null)
        {
            return PayloadTooLarge($"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }
        var body = Encoding.UTF8.GetString(bytes);
```

(the existing `if (request.ContentLength > options.MaxBatchBytes)` early return is replaced by the reader's own check).

- [ ] **Step 4: Implement the endpoint**

Create `backend/LogHarbor.Api/Endpoints/OtlpEndpoints.cs`:

```csharp
using System.Text;
using Google.Protobuf;
using OpenTelemetry.Proto.Collector.Logs.V1;
using LogHarbor.Api.LiveTail;
using LogHarbor.Core.Events.Otlp;
using LogHarbor.Core.Storage;

namespace LogHarbor.Api.Endpoints;

/// <summary>
/// OTLP/HTTP log ingestion (docs/ingestion-otlp.md). Standard /v1/logs path, both protobuf
/// and JSON encodings, so OTEL_EXPORTER_OTLP_ENDPOINT pointed at LogHarbor just works.
/// Rides the same pipeline as CLEF: API key gate, rate limit, WriteBatch, tail broadcast.
/// </summary>
public static class OtlpEndpoints
{
    public static void MapOtlp(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/logs", HandleLogsAsync).RequireRateLimiting(IngestionEndpoints.RateLimitPolicy);
    }

    private static async Task<IResult> HandleLogsAsync(
        HttpRequest httpRequest,
        IEventStore eventStore,
        TailBroadcaster tailBroadcaster,
        IngestionOptions options,
        CancellationToken cancellationToken)
    {
        var contentType = httpRequest.ContentType ?? "";
        var isProtobuf = contentType.StartsWith("application/x-protobuf", StringComparison.OrdinalIgnoreCase);
        var isJson = contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase);
        if (!isProtobuf && !isJson)
        {
            return Results.Problem(statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: "Unsupported content type",
                detail: "POST /v1/logs accepts application/x-protobuf or application/json.");
        }

        var body = await RequestBody.ReadCappedAsync(httpRequest, options.MaxBatchBytes, cancellationToken);
        if (body is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "Payload too large",
                detail: $"Batch exceeds MaxBatchBytes ({options.MaxBatchBytes}).");
        }

        ExportLogsServiceRequest request;
        if (isProtobuf)
        {
            try
            {
                request = ExportLogsServiceRequest.Parser.ParseFrom(body);
            }
            catch (InvalidProtocolBufferException ex)
            {
                return BadRequest(ex.Message);
            }
        }
        else
        {
            if (!OtlpJson.TryParse(Encoding.UTF8.GetString(body), out var parsed, out var error))
            {
                return BadRequest(error!);
            }
            request = parsed!;
        }

        var result = OtlpLogParser.Parse(request, DateTimeOffset.UtcNow, options.MaxEventBytes);
        var ids = await eventStore.WriteBatchAsync(result.Events, cancellationToken);
        await tailBroadcaster.BroadcastAsync(ids, cancellationToken);

        var response = new ExportLogsServiceResponse();
        if (result.RejectedLogRecords > 0)
        {
            response.PartialSuccess = new ExportLogsPartialSuccess
            {
                RejectedLogRecords = result.RejectedLogRecords,
                ErrorMessage = result.ErrorMessage ?? "",
            };
        }
        // the response mirrors the request's encoding, per the OTLP/HTTP spec
        return isProtobuf
            ? Results.Bytes(response.ToByteArray(), "application/x-protobuf")
            : Results.Text(JsonFormatter.Default.Format(response), "application/json");
    }

    private static IResult BadRequest(string detail) =>
        Results.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Invalid OTLP payload", detail: detail);
}
```

- [ ] **Step 5: Wire Program.cs**

Three edits in `backend/LogHarbor.Api/Program.cs`:

1. The ApiKeyMiddleware gate covers all of /v1 (OTLP clients authenticate by API key, like every ingestion path):

```csharp
app.UseWhen(
    context => context.Request.Path.StartsWithSegments("/api/events/raw")
        || context.Request.Path.StartsWithSegments("/v1"),
    branch => branch.UseMiddleware<ApiKeyMiddleware>());
```

2. After `app.MapIngestion();` add:

```csharp
app.MapOtlp();
```

3. In the `MapFallback` handler, unknown /v1 paths are client errors like /api ones — an OTLP exporter posting to an unimplemented signal (e.g. /v1/traces) must get a 404, not the SPA's HTML:

```csharp
    if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/hubs")
        || context.Request.Path.StartsWithSegments("/v1"))
```

- [ ] **Step 6: Run the tests to verify they pass, then the full suite**

Run: `dotnet test backend --filter "FullyQualifiedName~OtlpEndpointsTests"` then `dotnet test backend`
Expected: PASS both — including the untouched `IngestionEndpointsTests` (the shared reader must not change CLEF behavior).

- [ ] **Step 7: Commit**

```bash
git add backend/LogHarbor.Api/Endpoints/OtlpEndpoints.cs backend/LogHarbor.Api/Endpoints/RequestBody.cs backend/LogHarbor.Api/Endpoints/IngestionEndpoints.cs backend/LogHarbor.Api/Program.cs backend/LogHarbor.Tests/Api/OtlpEndpointsTests.cs
git commit -m "feat: add OTLP/HTTP log ingestion at /v1/logs" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Create: `docs/ingestion-otlp.md`
- Modify: `docs/architecture.md` (Ingestion API component + references list in CLAUDE.md is NOT touched — CLAUDE.md is git-ignored)
- Modify: `docs/api.md` (INGESTION section)
- Modify: `docs/data-model.md` (INGESTION NORMALIZATION pointer)
- Modify: `README.md`, `README_TR.md` (sending-logs sections)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–7.
- Produces: user-facing docs; no code.

- [ ] **Step 1: Create docs/ingestion-otlp.md**

```markdown
# Sending Events With OpenTelemetry (OTLP)

LogHarbor accepts the OpenTelemetry protocol for logs: OTLP/HTTP on the standard
/v1/logs path, in BOTH encodings (binary protobuf and JSON). Anything that speaks
OTLP — an OTel SDK in any language, an OTel Collector, or another forwarder —
ingests into LogHarbor without a Seq-compatible sink.

  POST /v1/logs
    X-LogHarbor-ApiKey: <token>          (same key as CLEF ingestion)
    Content-Type: application/x-protobuf | application/json

Not implemented: OTLP/gRPC (:4317) and the traces/metrics signals; POST /v1/traces
answers 404 so exporters fail fast instead of buffering forever.

--- SDK CONFIGURATION (ANY LANGUAGE) ---

OTel SDKs read these environment variables; no code change needed:

  OTEL_EXPORTER_OTLP_ENDPOINT=http://logharbor:5000
  OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
  OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<token>

(http/json also works where the SDK supports it. The key is a secret: environment
only, never committed — rules.md SECURITY.)

--- OTEL COLLECTOR ---

Already running a Collector? Add an exporter and put it in the logs pipeline:

  exporters:
    otlphttp/logharbor:
      endpoint: http://logharbor:5000
      headers:
        X-LogHarbor-ApiKey: ${env:LOGHARBOR_API_KEY}

  service:
    pipelines:
      logs:
        exporters: [otlphttp/logharbor]

--- MAPPING (LogRecord -> Event) ---

severity_number 1-24 -> the six canonical levels in blocks of four
  (1-4 Verbose, 5-8 Debug, 9-12 Information, 13-16 Warning, 17-20 Error,
  21-24 Fatal); missing number -> severity_text through the CLEF alias map
time_unix_nano -> timestamp (UTC fixed format, future clamp — same normalization
  as CLEF @t); 0 -> observed_time_unix_nano; both 0 -> server time
body            -> message (string bodies as-is, structured bodies as JSON text)
message_template.text attribute -> message_template (Serilog's OTel sink sends it;
  error grouping on the Analysis page works exactly like CLEF @mt)
trace_id/span_id -> lowercase hex into the trace columns (@TraceId/@SpanId filters)
attributes      -> properties; resource attributes (service.name, ...) merge in
  first, so a record attribute wins on key collision
exception.type/message/stacktrace attributes -> the exception column, composed as
  "{type}: {message}\n{stacktrace}" so exception grouping matches .NET text

Dotted attribute keys are first-class in filters: service.name = 'checkout-api'
(docs/query-language.md PROPERTY ACCESS).

--- RESPONSES ---

200 with ExportLogsServiceResponse (same encoding as the request)
  partial_success set when records were dropped (rejected_log_records +
  error_message) — today that means single records over MaxEventBytes
400 unparseable body | 401 bad key | 404 unknown /v1 path
413 over MaxBatchBytes | 415 unsupported content type | 429 rate limited

--- SMOKE TEST ---

  curl -X POST "$LOGHARBOR_URL/v1/logs" \
    -H "X-LogHarbor-ApiKey: $LOGHARBOR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"curl-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"0","severityNumber":9,"body":{"stringValue":"hello from OTLP"}}]}]}]}'

Expect {} back; the event appears in the UI with service.name = 'curl-test'.
```

- [ ] **Step 2: Update docs/architecture.md**

In the COMPONENTS section, extend the "Ingestion API" block with:

```
  POST /v1/logs accepts OTLP/HTTP (OpenTelemetry logs) in protobuf and JSON
  encodings — standard path, so OTEL_EXPORTER_OTLP_ENDPOINT pointed at LogHarbor
  works with any OTel SDK or Collector (docs/ingestion-otlp.md); same API-key
  gate and rate limits as CLEF
```

- [ ] **Step 3: Update docs/api.md**

Find the ingestion section (`POST /api/events/raw`) and add below it:

```
POST /v1/logs
  OTLP/HTTP log ingestion (docs/ingestion-otlp.md). X-LogHarbor-ApiKey header;
  Content-Type application/x-protobuf or application/json.
  200 ExportLogsServiceResponse (partial_success when records were dropped),
  400/401/413/415/429 as for CLEF ingestion.
```

- [ ] **Step 4: Update docs/data-model.md**

Append to INGESTION NORMALIZATION:

```
OTLP: /v1/logs events go through the same normalization; the full
  LogRecord -> Event mapping table lives in docs/ingestion-otlp.md.
```

- [ ] **Step 5: Update README.md and README_TR.md**

`README.md` — after the section that shows sending logs (Serilog/NLog/Winston), add:

```markdown
### OpenTelemetry (OTLP)

Any OTel SDK or Collector can send logs directly — no Seq sink needed:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5000
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<your-key>
```

Both protobuf and JSON encodings are accepted on `/v1/logs`. See
[docs/ingestion-otlp.md](docs/ingestion-otlp.md) for the Collector config and
the full field mapping.
```

`README_TR.md` — same place, in Turkish:

```markdown
### OpenTelemetry (OTLP)

Herhangi bir OTel SDK'sı veya Collector, Seq sink'i olmadan doğrudan log gönderebilir:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5000
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<anahtarınız>
```

`/v1/logs` hem protobuf hem JSON kodlamasını kabul eder. Collector yapılandırması
ve alan eşleme tablosu için [docs/ingestion-otlp.md](docs/ingestion-otlp.md).
```

- [ ] **Step 6: Verify docs build nothing (no code) — run the suite once for hygiene**

Run: `dotnet test backend`
Expected: PASS (docs only).

- [ ] **Step 7: Commit**

```bash
git add docs/ingestion-otlp.md docs/architecture.md docs/api.md docs/data-model.md README.md README_TR.md
git commit -m "docs: document OTLP log ingestion" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `dotnet test backend` — all green
- [ ] `npm run build` in `frontend/` — still green (no frontend change expected; build guards against accidental type breakage via shared files)
- [ ] Mark the six Phase 12-B items done (`[x]`) in todo.md
- [ ] Manual test (todo.md's last 12-B item), after merge/deploy to the test server: run an OTel Collector container (or any OTLP exporter) against the deployed LogHarbor with the smoke-test curl from docs/ingestion-otlp.md; confirm the event in the UI, filter by `service.name`
