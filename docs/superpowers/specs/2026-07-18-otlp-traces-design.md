# OTLP Traces Ingestion — Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

LogHarbor ingests OTLP logs (`/v1/logs`) and already correlates them by
W3C `trace_id`/`span_id`; the trace page renders a waterfall *inferred*
from log timestamps (spans grouped by `span_id`, bounds from the earliest
and latest event). That inference is a lower bound — no real durations, no
parent/child nesting, no span names or status. OTel SDKs emit real spans
for free over the OTLP door we already run. Phase 14 B: ingest spans into
their own table and render a real waterfall, the one deliberately deferred
"real APM" step. This is the committed bigger step, but kept lean — no full
archive tiering, no span search surface.

## Scope

In: `/v1/traces` ingestion, a `spans` table, a trace-scoped read API, a
real waterfall on the existing trace page (falling back to the inferred
panel), simple age-based retention.

Out (deliberately deferred): the events archive machinery for spans (daily
Brotli segments, hydration cache, span FTS); any spans search / list page;
span-based stats or a service map; live-tail of spans.

## Ingestion

Vendor the trace protos from open-telemetry/opentelemetry-proto v1.10.0
(matching the logs protos already in `Protos/`): `trace/v1/trace.proto` and
`collector/trace/v1/trace_service.proto`. The `.csproj` already globs
`Protos/**/*.proto`, so no build change is needed.

`POST /v1/traces` (`OtlpTraceEndpoints`), mirroring `OtlpEndpoints`:

- Same API-key gate and rate-limit policy, `MaxBatchBytes` cap, and both
  `application/x-protobuf` and `application/json` encodings (reusing
  `OtlpJson` for the JSON path against `ExportTraceServiceRequest`).
- Returns `ExportTraceServiceResponse`, with `partial_success`
  (`rejected_spans` + message) when spans were dropped, encoding-matched to
  the request like `/v1/logs`.
- Records `logharbor.ingest.duration` with tag `source="traces"`. Spans are
  NOT broadcast to live tail (a log-only feature).

## Parser and model

`OtlpTraceParser.Parse(ExportTraceServiceRequest, DateTimeOffset serverTime,
int maxSpanBytes)` → `OtlpTraceParseResult(IReadOnlyList<Span> spans, long
rejectedSpans, string? errorMessage)`.

`Span` record (LogHarbor.Core):

- `TraceId` (32 lowercase hex), `SpanId` (16 hex), `ParentSpanId` (16 hex or
  null when the root span carries an all-zero/empty parent).
- `Name`, `Kind` (the OTLP SpanKind int mapped to a short string:
  `internal|server|client|producer|consumer|unspecified`).
- `Service` — resource `service.name`, null when absent.
- `StartTimestamp` (ISO-8601 UTC, from `start_time_unix_nano`, clamped like
  log timestamps) and `DurationMs` (REAL, `(end - start) / 1e6`, floored at
  0 when a broken clock reports end < start).
- `StatusCode` (`unset|ok|error` from OTLP Status) and `StatusMessage`.
- `Attributes` — span attributes as a JSON object string (same
  `OtlpValues.ToJsonNode` mapping used for log records), null when empty.
- `IngestedAt`.

Validation: a span whose `trace_id` or `span_id` is missing/wrong-length/
all-zero is **rejected** (counted in `rejectedSpans`) — unlike logs, a span
with no id is useless. A span whose serialized size exceeds `maxSpanBytes`
(the existing `MaxEventBytes` option) is rejected.

## Storage

Migration `011_spans.sql`:

```
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

No FTS (spans are not full-text searched in this scope).

`ISpanStore` + `SqliteSpanStore`:

- `WriteBatchAsync(IReadOnlyList<Span> spans, ct)` — one transaction, like
  `WriteBatchAsync` for events.
- `GetTraceAsync(string traceId, ct)` → `IReadOnlyList<Span>` ordered by
  `start_timestamp`, then `id` (stable tie-break).
- `DeleteSpansOlderThanAsync(string cutoffUtc, ct)` → rows deleted.

Retention: the existing daily background retention pass also deletes spans
with `start_timestamp` older than `RetentionDays`. Spans are never
archived, so this runs regardless of the `CompressAfterDays` (archive
on/off) setting — bounded growth without the segment machinery.

## Read API

`GET /api/traces/{traceId}` (session-gated, read-only, viewer-allowed) →
`{ spans: [ { traceId, spanId, parentSpanId, name, kind, service,
startTimestamp, durationMs, statusCode, statusMessage, attributes } ] }`,
ordered as the store returns them. `attributes` is the raw JSON string (or
null). Unknown/empty trace → `{ spans: [] }`.

## Frontend

The trace page already appears when the Events filter is exactly
`@TraceId = '...'` (`TracePanel`). Extend it:

- New `getTrace(traceId)` in `api/traces.ts` and `useTrace(traceId)` hook
  (React Query key `['trace-spans', traceId]`).
- When `useTrace` returns spans, render the **real waterfall**: rows nested
  by `parentSpanId` (a tree, roots first, children indented). A span whose
  `parentSpanId` is null OR points to a span not present in the fetched set
  (a cross-service parent, or a dropped span) is treated as a root, so no
  span is ever hidden. Bars come from `startTimestamp`+`durationMs` on a
  shared axis, `error` status tinting the bar red. The trace's log events
  (already fetched by `useTraceEvents`) are overlaid as dots on the row
  whose `spanId` matches the event's `spanId`; log events whose `spanId`
  matches no span (or is null) collect on a trailing row.
- When `useTrace` returns no spans, fall back to today's inferred layout
  (`buildTraceLayout` over the log events) unchanged.
- Clicking a span opens a lightweight detail (name, service, kind,
  duration, status + message) with the `attributes` JSON rendered by the
  same property-tree component `EventDetail` already uses; if that component
  is not cleanly reusable, a plain key/value list is acceptable.
- TR/EN i18n for the new labels.

## Tests

- `OtlpTraceParserTests`: protobuf spans → `Span` (ids lowercased, service
  from resource, kind + status mapping, root parent null, duration math);
  a zero/short id span is rejected; an oversize span is rejected and counted.
- `OtlpTraceEndpointsTests`: protobuf and JSON round-trip → 200 with spans
  persisted; `partial_success.rejected_spans` on a bad span; 415 on a
  wrong content type; 413 over `MaxBatchBytes`; API-key gate.
- `SqliteSpanStoreTests`: write + `GetTraceAsync` ordering; range/other
  trace isolation; `DeleteSpansOlderThanAsync` removes only old rows.
- `TraceEndpointsTests`: `GET /api/traces/{id}` shape; empty trace → `[]`.
- Frontend `TracePanel.test.tsx`: real waterfall from mocked spans (nesting,
  duration, error tint); log-dot overlay onto the matching span; fallback to
  the inferred layout when spans are empty.

## Retention config

No new settings. `RetentionDays` (existing) governs span deletion.
`MaxBatchBytes`/`MaxEventBytes` (existing) cap trace payloads and per-span
size. Archive settings do not apply to spans.
