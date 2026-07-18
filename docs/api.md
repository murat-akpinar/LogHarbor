# LogHarbor HTTP API

Base URL: /api
All responses JSON. Errors use ProblemDetails (RFC 7807).

--- AUTH ---

Multi-user auth, enabled automatically once at least one user account exists.
The first start seeds an 'admin' account, so a fresh install is never reachable without a
login; after that, accounts are managed under /api/users. Roles: admin (full access) and
viewer (read-only: GETs, /api/query/validate and /api/archive/hydrate only).
When enabled, all endpoints except ingestion, /healthz and /api/auth/* require a
session cookie; mutating requests additionally require the admin role, and all of
/api/users requires admin regardless of method. The SignalR hub /hubs/tail requires
the same session cookie (it streams log data).

Seeding the first admin:
  LOGHARBOR_ADMIN_PASSWORD set  -> that password, ready to use
  nothing configured        -> admin/admin, with mustChangePassword

mustChangePassword means the session can do nothing but change its own password: everything
behind the auth gate answers 403 "Password change required" until POST /api/auth/password
succeeds (which re-issues the cookie without the flag). /api/auth stays outside the gate, so
login, logout and the change itself keep working. That is what makes a zero-configuration
install safe: default credentials exist, but they cannot read a single log line.
LogHarbor:SeedDefaultAdmin=false turns the seeding off entirely (tests, and installs that manage
the user table themselves).

POST /api/auth/login     body { username, password }
                         200: { authenticated, username, role, mustChangePassword } | 401
                         429 after repeated failures
POST /api/auth/logout    204
POST /api/auth/password  body { currentPassword, newPassword }  changes the caller's own password
                         204 | 400 (newPassword under 8 chars, or same as the current one)
                         401 (no session, or currentPassword wrong) | 429, rate limited like login
GET  /api/auth/status    200: { "authRequired": bool, "authenticated": bool, "username": string|null,
                                "role": "admin"|"viewer", "mustChangePassword": bool }

--- USERS (admin only) ---

GET    /api/users      200: [ { id, username, role, createdAt } ]  (passwords never returned)
POST   /api/users      body { username, password, role }  201: User | 400 validation
                        (username: 1-64 chars [A-Za-z0-9._-]; password: min 8 chars;
                        role: 'admin'|'viewer'; the first user ever created must be admin)
DELETE /api/users/{id} 204 | 404 | 400 when deleting the last remaining admin

--- INGESTION ---

POST /api/events/raw
  Headers: X-LogHarbor-ApiKey: <token>, Content-Type: application/vnd.serilog.clef
  Body: newline-delimited CLEF JSON events
  201 Created | 400 invalid payload | 401 missing/invalid key | 413 too large | 429 rate limited
  Limits: MaxBatchBytes per request, MaxEventBytes per event, rate limit per API key

  X-Seq-ApiKey is accepted as an alias for X-LogHarbor-ApiKey (checked only when the latter is
  absent), which makes the endpoint wire-compatible with Seq sinks: Serilog.Sinks.Seq,
  NLog.Targets.Seq, seqlog, winston-seq all work by pointing them at LogHarbor
  (docs/ingestion-app.md).

Example body:
{"@t":"2026-07-13T10:00:00Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}

POST /v1/logs
  OTLP/HTTP log ingestion (docs/ingestion-otlp.md). X-LogHarbor-ApiKey header;
  Content-Type application/x-protobuf or application/json.
  200 ExportLogsServiceResponse (partial_success when records were dropped),
  400/401/413/415/429 as for CLEF ingestion.

POST /v1/traces
  OTLP/HTTP trace ingestion (docs/ingestion-otlp.md). Same header and encodings as
  /v1/logs; spans land in the spans table (read them via GET /api/traces/{id}).
  200 ExportTraceServiceResponse (partial_success.rejected_spans when spans were
  dropped for a missing id or exceeding MaxEventBytes), 400/401/413/415/429 as above.

--- EVENTS (SEARCH) ---

GET /api/events
  Query params:
    filter   optional, LogHarbor filter expression (docs/query-language.md)
    from     optional, ISO-8601 UTC lower bound
    to       optional, ISO-8601 UTC upper bound
    count    optional, page size, default 100, max 1000
    afterId  optional, keyset pagination cursor (return events with id < afterId)
  200: { "events": [Event], "hasMore": bool }
  Ordered by id DESC, matching the afterId cursor exactly (gap-free pagination).
  Timestamps come from clients, so a late-arriving batch with old @t values may
  appear slightly out of timestamp order; ordering by timestamp with an id cursor
  would skip or repeat events, so id order wins.

GET /api/events/{id}
  200: full Event | 404

GET /api/events/export
  Query params: same filter/from/to as GET /api/events, plus:
    format  'json' | 'csv', default 'json'
    limit   default 10000, max 100000
  200: file download (Content-Disposition attachment), paged internally in the same
  order as the search. CSV cells that start with =, +, - or @ are prefixed with a
  leading ' to defuse spreadsheet formula injection from untrusted log content.

GET /api/search/suggest
  Query params: prefix (default ""), property (optional)
  Without property: 200 { "suggestions": [propertyName, ...] } — up to 10 distinct
    JSON property keys seen on recent events, matching the prefix.
  With property: 200 { "suggestions": [value, ...] } — up to 10 distinct values seen
    for that property, matching the prefix. Built-in fields (@Level etc.) are not covered.

--- SIGNALS ---

GET    /api/signals              200: [Signal]
POST   /api/signals              body { title, filter }  201: Signal | 400 invalid filter
PUT    /api/signals/{id}         body { title, filter }  200: Signal | 404
DELETE /api/signals/{id}         204 | 404 | 400 when an alert rule still references the signal

--- ALERTS ---

Evaluated once a minute. An `at-least` rule (the default) fires a webhook POST when a
signal matches at least thresholdCount events within the trailing windowMinutes. A
`silence` rule (dead man's switch) fires when the signal matched at least once between
the rule's creation and the start of the window, but zero events within the window —
a once-alive heartbeat that stopped.

GET    /api/alerts        200: [ { id, title, signalId, thresholdCount, windowMinutes, webhookUrl,
                                    isEnabled, createdAt, lastTriggeredAt, lastError, payloadFormat,
                                    condition } ]
POST   /api/alerts        body { title, signalId, thresholdCount, windowMinutes, webhookUrl, isEnabled,
                                 payloadFormat?, condition? }
                          201: AlertRule | 400 validation | 400 duplicate title | 400 unknown signal
PUT    /api/alerts/{id}   same body  200: AlertRule | 404 | 400 (as above)
DELETE /api/alerts/{id}   204 | 404

condition is 'at-least' (default; thresholdCount must be >= 1) or 'silence' (thresholdCount
is ignored and may be 0). webhookUrl must be an absolute http(s) URL (never a file path or
other local scheme). After firing (successfully or not) a rule cools down for one full
windowMinutes before it can retrigger, so a dead webhook is not hammered every evaluation
pass; a silence rule therefore re-fires once per window while the signal stays quiet.
payloadFormat picks the webhook body shape (default generic):
  generic (at-least)  { rule, signal, filter, count, threshold, windowMinutes, from, to }
  generic (silence)   { rule, signal, filter, condition: "silence", count: 0, windowMinutes, from, to }
  slack    { "text": "LogHarbor alert '<rule>': ..." }
  discord  { "content": same message }   (paste a Slack/Discord incoming-webhook
                                          URL as webhookUrl and pick its format)

--- API KEYS ---

GET    /api/apikeys              200: [ { id, title, createdAt, isActive } ]  (never returns tokens)
POST   /api/apikeys              body { title }  201: { id, title, token }  token shown only here
DELETE /api/apikeys/{id}         204 (sets is_active = 0)

--- DASHBOARD / STATS ---

GET /api/stats/histogram
  Query: filter?, from, to, buckets (default 50)
  200: { "buckets": [ { "start", "counts": { "Error": n, "Warning": n, ... } } ] }

GET /api/stats/summary
  Query: filter?, from, to  (same filter support as histogram, so dashboard
  cards and chart always describe the same slice)
  200: { "total", "byLevel": { level: count } }

GET /api/stats/heatmap
  Query: filter?, from, to
  Counts by (day-of-week, hour-of-day), both UTC; dayOfWeek 0 = Sunday.
  Searches hot + hydrated data; cells with no events are omitted.
  200: { "cells": [ { dayOfWeek, hour, count } ] }

--- ANALYSIS ---

These endpoints share filter?/from/to (from/to required) and limit?
(default 20 unless noted, max 100), and search hot + hydrated data (same
UNION as /api/events). Results are ordered by count descending.

GET /api/stats/top-errors
  Query: also levels? (repeatable, default Error and Fatal)
  Groups events by (message_template, level); events without a CLEF @mt are excluded.
  200: { "errors": [ { template, level, count, firstSeen, lastSeen } ] }

GET /api/stats/top-exceptions
  Groups events by exception type = first line of the exception up to ':'
  (the whole first line when it has no colon).
  200: { "exceptions": [ { type, count, firstSeen, lastSeen } ] }

GET /api/stats/property-values
  Query: also property (required, [A-Za-z0-9_] only -> else 400)
  Top values of one structured property among matching events.
  200: { "values": [ { value, count } ] }

GET /api/stats/slow-operations
  Query: also property? (default Elapsed, [A-Za-z0-9_] only), minSamples? (default 20),
         floorMs? (default 50), factor? (default 2.0)
  Operation groups (by message_template) whose p95 of the numeric `property` in [from, to)
  is >= factor x the group's own baseline p95 (its history before `from`), most-regressed
  first. Guardrails: a group needs >= minSamples timed events in each window and a baseline
  p95 >= floorMs. No global threshold; each group is compared to itself.
  200: { "operations": [ { template, baselineP95, currentP95, count } ],
         "timedOperationCount": N,        // groups with >= 1 timed sample in [from, to)
         "comparableOperationCount": N }  // groups with >= minSamples in BOTH windows
  timedOperationCount is 0 when no event in the range carries the property; when it is
  non-zero but comparableOperationCount is 0, no group has a baseline before `from` to
  compare against (narrow the range). The two counts let the UI explain an empty list.

GET /api/stats/services
  Query: limit? default 50
  Per-service RED numbers. Service identity is the "service.name" property (OTLP
  resources) falling back to "Service" (CLEF/Seq senders); events carrying neither
  are excluded. errorCount counts Error + Fatal levels; p95ElapsedMs is the p95 of
  the numeric Elapsed property, null when no event of the service carried Elapsed.
  Ordered by total descending.
  200: { "services": [ { service, total, errorCount, p95ElapsedMs } ] }

--- TRACES ---

GET /api/traces/{traceId}
  All spans of a trace, ordered by startTimestamp then id, for the waterfall on the
  trace page. Session-gated, read-only; an unknown id returns an empty list, not 404.
  Spans are ingested via POST /v1/traces, retained by RetentionDays, and never archived.
  200: { "spans": [ { traceId, spanId, parentSpanId, name, kind, service, startTimestamp,
                      durationMs, statusCode, statusMessage, attributes } ] }

--- ARCHIVE ---

GET  /api/archive/segments                200: [ { day, filePath, eventCount, sizeBytes,
                                                   uncompressedBytes, status, hydratedAt,
                                                   lastAccessedAt } ]  newest day first
POST /api/archive/hydrate                 body { from, to } (both required, ISO-8601)
                                          202: { segments: [ { day, status } ] }
                                          claims cold segments in range, hydrates in background
GET  /api/archive/hydrate/status?from&to  200: { segments: [ { day, status } ] }
GET  /api/settings/archive                200: { compressAfterDays, hydrationKeepDays, retentionDays }
PUT  /api/settings/archive                body same shape  200: saved settings | 400 validation

Note: GET /api/events responses always include "archivedDays": [ "YYYY-MM-DD" ] — the
cold (non-hydrated) archive days the requested range touches; empty when none.

--- BACKUP (admin only) ---

GET /api/admin/backup    200: application/octet-stream, a consistent snapshot of the
                         whole SQLite database (VACUUM INTO, safe while the server runs;
                         WAL folded in, output compacted); Content-Disposition names it
                         logharbor-backup-YYYYMMDD-HHmmss.db. Everything under /api/admin
                         is admin-only even for GET (AuthPolicy.RequiresAdmin).
                         Restore steps: README "Backup & restore".

--- NOT FOUND ---

Unknown paths under /api and /hubs return 404 ProblemDetails, never the SPA shell;
all other unknown paths fall back to index.html so client-side routes deep link.

--- QUERY VALIDATION ---

POST /api/query/validate
  body { filter }
  200: { "valid": true } | { "valid": false, "error": "message", "position": n }

--- REALTIME (SIGNALR) ---

Hub: /hubs/tail
Client -> server: Subscribe(filter?: string)
Server -> client: EventsArrived(events: Event[])
Only events matching the subscribed filter are pushed.

--- HEALTH ---

GET /healthz    200: { "status": "ok", "eventCount": n, "dbSizeBytes": n }

--- SWAGGER (admin only) ---

GET /swagger    interactive API docs (Swashbuckle), every environment; requires an
                admin session — anonymous 401, viewer 403. The session cookie is
                already in the browser, so "Try it out" executes real requests.
