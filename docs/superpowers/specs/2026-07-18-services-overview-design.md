# Services Overview (APM-lite RED) — Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

Events already carry a service identity (`service.name` from OTLP resources,
`Service` from CLEF/Seq senders) plus levels and `Elapsed`, but nothing
answers "which of my services is unhealthy?" at a glance. Phase 14 A —
value from data we already store, no new ingestion.

## Backend

`GET /api/stats/services?from&to[&filter][&limit=50]` →
`{ services: [ { service, total, errorCount, p95ElapsedMs } ] }`

New store method `GetServiceOverviewAsync` (IEventStore + SqliteEventStore):

- Service identity: `COALESCE` of the quoted JSON paths `$."service.name"`
  then `$."Service"`; events carrying neither stay off the page.
- `errorCount`: levels Error + Fatal.
- `p95ElapsedMs`: the slow-operations ROW_NUMBER window-percentile pattern
  over `CAST($."Elapsed" AS REAL)`, null when the service has no Elapsed.
- Ordered by total desc, limit clamped like the sibling endpoints
  (`TryValidateCommon` handles range/filter/limit).
- Rides `BuildStatsSourceAsync`, so hydrated archive segments participate
  exactly like the other stats.

## Tripwire metric (parked write-path item's guard)

`logharbor.ingest.duration` histogram (ms, tag `source`=clef|otlp) recorded
across each successful ingestion request (parse + write + broadcast), so
"revisit the channel refactor when ingest p99 degrades" is observable in the
field. Same conditional OTel export as the other instruments.

## Frontend

New nav page **Services** (between Dashboard and Analysis):

- TimeRangePicker (same presets) + table: Service | rate (ev/min, from
  total/range) | errors % | p95 Elapsed | 24-bucket sparkline (per-row
  `getHistogram` filtered to the service, Analysis top-errors pattern).
- Row click → Events deep link with
  `(service.name = 'x' or Service = 'x')` + the range.
- Empty state text; TR/EN i18n; viewer-accessible (read-only GET).

## Tests

Store: both property spellings coalesce, error counting, p95 math, no-service
events excluded, range bounds. Endpoint: shape + validation. Metrics: ingest
CLEF/OTLP records `logharbor.ingest.duration` with the right source tag.
Frontend: page renders rows from mocked API (rate/error % math), row deep-link
href, nav entry.

## Out of scope

Health scoring, thresholds/coloring, auto-refresh, per-service pages.
