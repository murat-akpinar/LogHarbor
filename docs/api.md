# LogHarbor HTTP API

Base URL: /api
All responses JSON. Errors use ProblemDetails (RFC 7807).

--- AUTH ---

Multi-user auth, enabled automatically once at least one user account exists, or once
directory sign-in is configured — an LDAP-only install legitimately has no local accounts,
and counting them alone left every endpoint open on a server that looked configured.
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

POST /api/auth/login     body { username, password, method? }
                         method: 'standard' (default, the local user table) or 'ldap'
                         (the configured directory, docs/ldap.md). A directory sign-in
                         creates no local account; the role comes from group membership
                         and is re-read on every login.
                         200: { authenticated, username, role, mustChangePassword } | 401
                         429 after repeated failures
POST /api/auth/logout    204
POST /api/auth/password  body { currentPassword, newPassword }  changes the caller's own password
                         204 | 400 (newPassword under 8 chars, or same as the current one)
                         401 (no session, or currentPassword wrong) | 429, rate limited like login
GET  /api/auth/status    200: { "authRequired": bool, "authenticated": bool, "username": string|null,
                                "role": "admin"|"viewer", "mustChangePassword": bool,
                                "ldapEnabled": bool }
                         ldapEnabled is readable unauthenticated on purpose: the login page has
                         to know whether to offer the directory tab before anyone has signed in.

--- USERS (admin only) ---

GET    /api/users      200: [ { id, username, role, createdAt } ]  (passwords never returned)
POST   /api/users      body { username, password, role }  201: User | 400 validation
                        (username: 1-64 chars [A-Za-z0-9._-]; password: min 8 chars;
                        role: 'admin'|'viewer'; the first user ever created must be admin)
DELETE /api/users/{id} 204 | 404 | 400 when deleting the last remaining admin

--- INGESTION ---

POST /api/events/raw
  Headers: X-LogHarbor-ApiKey: <token>, Content-Type: application/vnd.serilog.clef
  Body: newline-delimited CLEF JSON events, or Seq's {"Events":[...]} envelope
  201 Created | 400 invalid payload | 401 missing/invalid key | 413 too large | 429 rate limited
  Limits: MaxBatchBytes per request, MaxEventBytes per event, rate limit per API key

  X-Seq-ApiKey is accepted as an alias for X-LogHarbor-ApiKey (checked only when the latter is
  absent), which makes the endpoint wire-compatible with Seq sinks: Serilog.Sinks.Seq,
  NLog.Targets.Seq, seqlog, winston-seq all work by pointing them at LogHarbor
  (docs/ingestion-app.md).

  Every rejection here is recorded and readable at GET /api/stats/ingest-rejections — a 4xx
  otherwise leaves no trace on the server, and the client silently drops the batch.

  Both of Seq's body formats are accepted, distinguished by the body rather than Content-Type:
  a JSON object whose top level holds an "Events" array (and no CLEF @t) is the envelope,
  everything else is parsed as CLEF lines. Serilog and NLog send CLEF; seqlog and winston-seq
  send the envelope. 400 details name the position in the format that was sent — "line 2: ..."
  for CLEF, "event 2: ..." for the envelope — and no event of a rejected batch is stored.

Example CLEF body:
{"@t":"2026-07-13T10:00:00Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}

Example Seq raw events body (Timestamp required; MessageTemplate/Message/Exception mirror
@mt/@m/@x; Properties is the property bag; Renderings and EventType are ignored):
{"Events":[{"Timestamp":"2026-07-13T10:00:00Z","Level":"Error",
            "MessageTemplate":"Order {OrderId} failed","Properties":{"OrderId":123}}]}

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
  409: the range contains archived days, named in the detail. They would be missing
  from the file with no visible gap, so the export refuses rather than writing a
  quietly incomplete download — extract them first (POST /api/archive/hydrate).

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

GET /api/stats/ingest-rejections
  Query: days? (1..30, default 7)
  Ingestion requests that were turned away, so events a client believes it sent but that
  were never stored are visible without reading server logs. Aggregated per (api key,
  reason, UTC day) rather than per request: a misconfigured client retries forever.
  reason is one of unauthorized | rate_limited | invalid_payload | too_large |
  unsupported_media_type | write_failed. write_failed is the 5xx half — the batch was
  valid and storage failed (full disk, read-only mount), so unlike the others nothing
  on the client side is wrong and nothing there will ever correct it. apiKeyId 0 (apiKeyTitle null) means the request had no valid key.
  lastDetail is the server's own message, capped at 200 chars, and can quote the client's
  payload. Buckets are kept 30 days, independent of RetentionDays.
  200: { "rejections": [ { apiKeyId, apiKeyTitle, reason, day, requestCount,
                           firstSeen, lastSeen, lastDetail } ], "totalRequests" }

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

GET /api/stats/service-status
  Query: source? default "service-probe", staleMinutes? default 5 (1..1440),
         limit? default 100
  Up/down for the host's own services, from the events tools/service-probe sends
  (docs/service-status.md). Takes the newest reading per (host, service) — readings
  without both properties are excluded — and derives a status against `to`, not
  wall-clock now, so a historical range reads as how things stood then:
    down       fresh reading with up = 0
    stale      last reading older than staleMinutes (service, probe or host is gone)
    unhealthy  fresh, up = 1, health = "unhealthy"
    unknown    fresh reading with no `up` at all (the probe could not ask)
    up         fresh, up = 1
  Ordered worst first in exactly that order, then by host, then service. 400 when
  staleMinutes is out of range.
  200: { "staleMinutes": N, "asOf": "<to>",
         "services": [ { host, kind, service, status, state, health, lastSeen,
                         secondsSinceLastSeen } ] }

GET /api/settings/ldap
  Admin only, unlike the other settings: it describes somebody else's infrastructure —
  directory host, base DN, and the name of the group that grants admin.
  200: { enabled, host, port, security, baseDn, upnSuffix, userDnPattern, adminGroup,
         viewerGroup, nestedGroups, allowInvalidCertificate, usesDnBind }
  Holds no password by design: LogHarbor binds as the user signing in, so there is no
  service account and nothing secret to store (docs/ldap.md).

PUT /api/settings/ldap
  Admin only. Same body; validated only when enabled is true, because a half-filled card
  saved with the feature off is someone still typing. 400 when: neither upnSuffix nor
  userDnPattern is set (nothing to bind as), userDnPattern has no {0}, both group names
  are blank (no directory user could earn a role), security is not
  ldaps/starttls/none, or port is outside 1..65535.
  Saving enabled=true turns authentication on for the whole server even with no local
  accounts, and takes effect without a restart.
  200: the saved settings

POST /api/settings/ldap/test
  Admin only. Body: { username, password, settings? }. Asks the directory what it would
  say about these credentials and creates NO session. Uses `settings` when sent, so the
  Settings card can test what is on screen before saving; falls back to the stored ones.
  200: { bound, succeeded, role, groups, detail }
  `detail` names the reason a sign-in would fail — safe here and nowhere else, because
  this endpoint is admin-only. The login path answers 401 with none of it.

GET /api/stats/operations
  Query: routeProperty? default Path, methodProperty? default Method
         (both [A-Za-z0-9_.] only), limit? default 50
  Per-operation RED numbers. An event carrying BOTH properties is grouped as a route and
  comes back with method + route filled and template set to "GET /orders/{id}"; anything
  else falls back to its CLEF message_template (method and route null), so jobs and probes
  stay on the list. Both are required on purpose: a line that names a path without a verb
  ("Slow request {Path} took {Elapsed} ms") is about that path, not about its traffic, and
  grouping it as a route would add a second row under the same name whose p95 was measured
  over a different set of events. A request log writes one template for every route it serves,
  which is why the route properties decide the grouping and not the template.
  Property names differ per sink: Path/Method here, RequestPath/RequestMethod under
  Serilog's ASP.NET middleware, http.route/http.request.method under OTel.
  Ids are folded out of the path before grouping, so an app that logs the raw path
  ("/api/orders/41973") groups as "/api/orders/{id}" instead of producing one group per
  request. A segment is an id when it is all digits, or a hex/uuid run of 16 characters or
  more; a path that carries no id is passed through byte for byte, which is why an install
  whose sink already logs route templates sees no difference. Measured on 200k events:
  126,267 groups became 12, and the busiest route in the app (59,980 requests, absent from
  the response entirely because each of its rows held one hit) became the top row.
  folded says the route holds {id} placeholders this server put there. No event carries that
  text, so a filter built from a folded row has to match the pattern — replace each {id} with
  % and use `like` — while an unfolded row still filters with `=`.
  errorCount counts Error + Fatal levels; p95ElapsedMs is the p95 of the numeric Elapsed
  property, null when no event of the group carried Elapsed. Ordered by total descending.
  200: { "operations": [ { template, total, errorCount, p95ElapsedMs, method, route,
                           folded } ] }

GET /api/stats/user-activity
  Query: property? default UserId ([A-Za-z0-9_.] only), limit? default 50
  Per-value activity for one user-identifying property: total events, Error + Fatal
  count and last-seen timestamp, grouped by the property (events without it excluded),
  ordered by total descending.
  200: { "users": [ { value, total, errorCount, lastSeen } ] }

GET /api/stats/queries
  Query: property? default commandText, durationProperty? default elapsed,
         connectionProperty? default connection (all [A-Za-z0-9_.] only),
         limit? default 50
  Groups events carrying the query-text property (SQL string) and aggregates the
  duration property per group; connection is the connection property's value when
  present. Ordered by total duration descending (untimed groups last). 400 when a
  property name contains other characters.
  200: { "queries": [ { value, connection, calls, errorCount, totalMs, avgMs,
                        p95Ms, lastSeen } ] }

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
                                                   lastAccessedAt, fileMissing } ]  newest day first
                                          fileMissing: the row is there but its .br file is not
                                          (a database restored without its archive directory).
                                          Those events cannot be produced; the UI shows the day
                                          as missing rather than offering to extract it.
POST /api/archive/hydrate                 body { from, to } (both required, ISO-8601)
                                          202: { segments: [ { day, status } ] }
                                          claims cold segments in range, hydrates in background
GET  /api/archive/hydrate/status?from&to  200: { segments: [ { day, status } ] }
GET  /api/archive/forecast                200: { databaseBytes, maxDatabaseBytes, sampleCount,
                                                observedHours, dailyGrowthBytes, daysUntilFull,
                                                oldestDay, status }
                                          Where the database file is heading, fitted over the
                                          sizes the hourly maintenance pass records.
                                          status: measuring (too little history; growth null) |
                                          steady (flat or shrinking; no date) | growing |
                                          at-ceiling (the size cap is dropping days now).
                                          daysUntilFull is null without a ceiling or when not
                                          growing. oldestDay is the day the cap would drop
                                          first. Read-only: it never takes a reading of its
                                          own, so polling cannot change the series.
GET  /api/settings/archive                200: { compressAfterDays, hydrationKeepDays,
                                                retentionDays, maxDatabaseBytes }
PUT  /api/settings/archive                body same shape  200: saved settings | 400 validation
                                          maxDatabaseBytes is optional and omitting it keeps the
                                          stored value — it arrived after the other three, and a
                                          client that predates it must not switch off a ceiling
                                          someone set. 0 disables; anything positive must be at
                                          least 64 MB, since a smaller cap would delete history
                                          every pass and still never fit.

Note: GET /api/events responses always include "archivedDays": [ "YYYY-MM-DD" ] — the
cold (non-hydrated) archive days the requested range touches; empty when none. The
Events page turns a non-empty list into a banner offering to extract them, so a range
whose data is all cold never renders as an unexplained empty result; /api/events/export
refuses such a range outright (409) rather than writing an incomplete file.

--- BACKUP (admin only) ---

GET /api/admin/backup    200: application/zip, named logharbor-backup-YYYYMMDD-HHmmss.zip,
                         holding logharbor.db (VACUUM INTO, safe while the server runs; WAL
                         folded in, output compacted) plus archive/<segment>.br for every
                         archive segment on disk.
                         Both parts are required: the database stores only the segments' file
                         names, so a database-only backup restores an instance that lists days
                         it cannot produce. Segments are already Brotli-compressed and are
                         stored in the zip without deflating them again.
                         Everything under /api/admin is admin-only even for GET
                         (AuthPolicy.RequiresAdmin). Restore steps: README "Backup & restore".

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

GET /healthz    No auth. 200 when the server can still store events, 503 when it cannot.
                { "status": "ok"|"degraded", "writable": bool, "roomForABatch": bool,
                  "lastWriteFailure": ts|null, "eventCount": n, "dbSizeBytes": n,
                  "freeDiskBytes": n|null }
                Degraded when any signal fires, because none is sufficient alone:
                  writable  a real insert inside a rolled-back transaction. Catches a
                            read-only mount or lost permissions. It is one small row, so on a
                            full disk SQLite still fits it in a free page and this stays true
                            while real batches fail — measured.
                  lastWriteFailure  the most recent write_failed rejection. Not a guess about
                            the next write but a write that already did not happen; counts
                            against health for 5 minutes, so a fixed disk recovers without a
                            restart and a broken one does not flap.
                  roomForABatch  free space is at least MaxBatchBytes. Covers the disk that
                            filled while nobody happened to be sending: the probe's one row
                            still fits and the last real failure ages out, so without this
                            the server would go back to reporting ok on a full disk.
                freeDiskBytes is for the volume holding the database, found by deepest mount
                point — asking for the path root reported the host filesystem while /data was
                full. Null where the platform will not report it.
                The Dockerfile HEALTHCHECK curls this with -f, so a degraded container stops
                claiming to be healthy.

--- SWAGGER (admin only) ---

GET /swagger    interactive API docs (Swashbuckle), every environment; requires an
                admin session — anonymous 401, viewer 403. The session cookie is
                already in the browser, so "Try it out" executes real requests.
