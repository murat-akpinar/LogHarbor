# Self-Telemetry (OpenTelemetry Metrics) — Design

**Date:** 2026-07-18
**Status:** Approved (user delegated selection; Phase 12 C, last non-deferred item)

## Problem

LogHarbor collects everyone else's telemetry and reports nothing about
itself. An operator cannot see ingest rate, query latency or archive-job
cost without reading the database. todo.md Phase 12 C: "OpenTelemetry .NET
SDK in the backend: ASP.NET Core instrumentation + custom meters (ingest
rate, query latency, archive job duration); exports only when
OTEL_EXPORTER_OTLP_ENDPOINT is set, off by default."

## Instruments (Core, BCL only)

`LogHarbor.Core/Telemetry/LogHarborMetrics.cs` — a static
`System.Diagnostics.Metrics.Meter("LogHarbor")`; Core gains **no** OTel
package dependency, and unlistened instruments cost near zero:

| Instrument | Type | Where recorded |
|---|---|---|
| `logharbor.ingest.events` | Counter\<long\>, tag `source` = `clef` \| `otlp` | ingestion endpoints, count of stored events per request |
| `logharbor.query.duration` | Histogram\<double\> (ms) | inside `SqliteEventStore.QueryAsync` — one point covers every search |
| `logharbor.archive.job.duration` | Histogram\<double\> (ms) | around one archiver compression run |

## Export wiring (Api only)

Packages: `OpenTelemetry.Extensions.Hosting`,
`OpenTelemetry.Instrumentation.AspNetCore`,
`OpenTelemetry.Exporter.OpenTelemetryProtocol`.

Registered ONLY when `OTEL_EXPORTER_OTLP_ENDPOINT` is non-empty (read via
configuration, so both the env var and test settings reach it):
service name `logharbor`, `.AddMeter("LogHarbor")` +
`AddAspNetCoreInstrumentation()` (HTTP server request metrics),
`AddOtlpExporter` with the endpoint passed through. The exporter honors the
standard `OTEL_EXPORTER_OTLP_*` env vars for protocol/headers. Unset ⇒ no
OTel service registered at all — off by default, zero overhead.

Metrics only: no tracing, no OTel logging provider (LogHarbor is the log
server; shipping its own logs elsewhere is somebody's later feature).

## Tests

MeterListener-based (BCL): a distinctive-size CLEF batch surfaces as one
`logharbor.ingest.events` measurement with `source=clef`; same for OTLP;
`GET /api/events` records `logharbor.query.duration`; an archiver run
records `logharbor.archive.job.duration`; the MeterProvider is registered
exactly when the endpoint setting is present (factory setting on/off).

## Docs

architecture.md (self-telemetry paragraph), README + README_TR configuration
tables (`OTEL_EXPORTER_OTLP_ENDPOINT` row).

## Out of scope

Tracing, OTel logs export, a /metrics Prometheus endpoint, dashboarding the
metrics inside LogHarbor itself.
