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
Because every GET is open to a viewer, a response that would hand one a secret has to
say so at the endpoint. Two do: /api/apikeys never returns a token to anyone (it exists
once, in the POST that creates it), and /api/alerts masks webhookUrl for non-admins.

Session lifetime differs by where the account came from, and the reason is that only one
of the two can be re-checked. A local account is a row: deleting it ends the session on
the very next request, and no endpoint changes a local role at all, so its cookie keeps
the scheme's 7-day sliding window. A directory principal has no row — their role is what
the directory answered at sign-in, and LogHarbor cannot ask again, because it binds as
the person signing in and never keeps their password. Their session therefore expires on
a fixed 12-hour deadline that does NOT slide: signing in again is the only re-check there
is, so it has to actually come round. Before this it slid, which meant an open tab renewed
a revoked admin's role indefinitely.

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

GET    /api/users      200: [ { id, username, role, createdAt, lastLoginAt, source } ]
                        (passwords never returned)
                        source 'local' — an account in the users table. id is its id,
                          createdAt is when it was created, lastLoginAt is null until the
                          first successful sign-in (a rejected password stamps nothing).
                        source 'ldap' — a directory principal that has signed in at least
                          once. id is null: there is no local row, nothing to edit or delete,
                          and the row grants nothing. createdAt is the first sign-in and role
                          is what the directory answered at the last one — the directory is
                          still asked again on every login (docs/ldap.md).
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

Evaluated once a minute. An `at-least` rule (the default) fires a webhook POST when the
watched filter matches at least thresholdCount events within the trailing windowMinutes. A
`silence` rule (dead man's switch) fires when that filter matched at least once between
the rule's creation and the start of the window, but zero events within the window —
a once-alive heartbeat that stopped.

A rule watches exactly one thing, and says which by sending exactly one of two fields:
`filter` (its own expression, the usual case) or `signalId` (a saved signal, when the same
filter is also one you toggle on while reading events). Sending both, or neither, is a 400
on `filter`; so is an expression that does not parse, which is checked at save time rather
than left for the next evaluation pass to discover. A rule with its own filter needs no
signal to exist at all, so an install with an empty Signals list can still alert.

GET    /api/alerts        200: [ { id, title, signalId, filter, thresholdCount, windowMinutes,
                                    webhookUrl, isEnabled, createdAt, lastTriggeredAt, lastError,
                                    payloadFormat, condition, acknowledgedUntil, acknowledgedBy } ]
                                (signalId and filter: exactly one is set, the other is null)
                          webhookUrl is MASKED for a viewer: scheme, host and port, then "/…".
                          It is a credential, not a setting — a Slack or Discord incoming hook is
                          a bearer token in URL form, and other targets carry theirs in the query
                          string — and every GET is open to the viewer role. Admins get it whole.
POST   /api/alerts        body { title, signalId | filter, thresholdCount, windowMinutes, webhookUrl,
                                 isEnabled, payloadFormat?, condition? }
                          201: AlertRule | 400 validation | 400 duplicate title | 400 unknown signal
PUT    /api/alerts/{id}   same body  200: AlertRule | 404 | 400 (as above)
                          switching which of the two is sent moves the rule between them
DELETE /api/alerts/{id}   204 | 404

webhookUrl is validated as an absolute http(s) URL and otherwise unrestricted: an admin may
point a rule at any address the server can reach, including hosts on its own network. That is
deliberate — an internal Mattermost or a script on the LAN is the ordinary case, and an
allow-list would break it for a threat the deployment already contains, since creating a rule
is admin-only and an admin can read the whole database anyway. Worth naming rather than
leaving implicit: the response body never comes back, but its status code does (a rule's
lastError reads "webhook answered HTTP 401"), so an admin can use it to learn what is
listening inside. Revisit if "admin" ever stops meaning "trusted with this server".

POST   /api/alerts/{id}/acknowledge   body { minutes }   200: AlertRule | 400 | 404
DELETE /api/alerts/{id}/acknowledge                      200: AlertRule | 404

Acknowledging silences a rule until now + minutes (1 .. 10080, the same ceiling as a
window): the evaluator skips it entirely — before the count query — so no webhook is
sent and lastTriggeredAt is not touched. It is not disabling: the rule stays enabled,
nothing about its schedule changes, and the moment the acknowledgement expires it fires
again if the condition still holds. That is the whole point — the lever an operator
reaches for at 3am must not be able to leave a rule off forever. DELETE lifts it early.
acknowledgedBy records the session's username where the install has sign-in, and null
where it does not; an acknowledgedUntil in the past is an expired one and is honoured
by nobody. Both are mutations, so both need the admin role.

condition is 'at-least' (default; thresholdCount must be >= 1) or 'silence' (thresholdCount
is ignored and may be 0). webhookUrl must be an absolute http(s) URL (never a file path or
other local scheme). After firing (successfully or not) a rule cools down for one full
windowMinutes before it can retrigger, so a dead webhook is not hammered every evaluation
pass; a silence rule therefore re-fires once per window while the signal stays quiet.
payloadFormat picks the webhook body shape (default generic). In the generic payloads `filter`
is always what was evaluated, and `signal` is the signal's name or null for a rule carrying its
own filter; the slack/discord message names the signal where there is one and the filter text
otherwise:
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

GET /api/stats/latency
  Query: filter?, from, to, buckets (default 50)
  Average and p95 of the Elapsed property, over the range and per bucket. The
  range figures are ranked over the same rows in one pass: a range p95 cannot be
  recovered from the bucket p95s. avgMs/p95Ms are null wherever nothing carried
  Elapsed - an untimed bucket is not a fast one - and `sampled` counts the events
  that did, so "nothing is timed here" is tellable from "everything was quick".
  200: { "avgMs", "p95Ms", "sampled",
         "buckets": [ { "start", "avgMs", "p95Ms" } ] }

GET /api/stats/summary
  Query: filter?, from, to  (same filter support as histogram, so dashboard
  cards and chart always describe the same slice)
  200: { "total", "byLevel": { level: count } }

GET /api/stats/heatmap
  Query: filter?, from, to
  Counts by (day-of-week, hour-of-day), both UTC; dayOfWeek 0 = Sunday.
  Searches hot + hydrated data; cells with no events are omitted.
  200: { "cells": [ { dayOfWeek, hour, count } ] }

GET /api/stats/ingestion-lag
  Query: filter?, from, to, lateAfterSeconds? (0..86400, default 60)
  How late the events in the range arrived, measured as ingested_at - timestamp: the
  dashboard's one answer to "is the x-axis of every chart above trustworthy?". An event
  whose own timestamp is in the future of its arrival is counted as skewed rather than
  as negatively late, because a client clock ahead of the server is a different fault.
  Percentiles are over the whole range, and worstTimestamp/worstIngestedAt name the one
  event that took longest so it can be looked up.
  200: { "lateAfterSeconds", "lag": { total, lateCount, skewedCount, p50Seconds,
                                      p95Seconds, maxSeconds, worstTimestamp,
                                      worstIngestedAt } }

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

GET /api/settings/redaction
  200: { "properties": ["password"], "enabled": true }
  Property names whose values are replaced with "[redacted]" as events arrive, on every
  ingestion path (docs/redaction.md). Empty is the shipped state and means nothing is
  redacted. Readable by any session.

PUT /api/settings/redaction
  Body: { "properties": ["Password", " token "] }
  Saves the list, trimmed, lowercased and deduplicated — matching is case-insensitive, so
  two entries differing only in case are one rule. 400 when there are more than 50 names,
  a name is longer than 64 characters, or one holds a control character. Admin only, like
  every mutation.
  200: the saved settings, in the same shape as the GET.

GET /api/stats/property-values
  Query: also property (required, [A-Za-z0-9_.] only -> else 400), limit? default 20
  Top values of one structured property among matching events.
  200: { "values": [ { value, count } ] }

GET /api/stats/slow-operations
  Query: also property? (default Elapsed, [A-Za-z0-9_.] only), minSamples? (default 20),
         floorMs? (default 50), factor? (default 2.0)
  Operation groups (by message_template) whose p95 of the numeric `property` in [from, to)
  is >= factor x the group's own baseline p95, most-regressed first. Guardrails: a group
  needs >= minSamples timed events in each window and a baseline p95 >= floorMs. No global
  threshold; each group is compared to itself.
  The baseline is [baselineFrom, from): four windows of history, never more than 24 hours,
  the same rule /api/stats/findings uses. It is not all of history — that version rescanned
  the whole database on every dashboard load and got slower every day the server ran, and it
  also meant a wider range was judged against *less* history, because the baseline ended
  where the window began.
  200: { "operations": [ { template, baselineP95, currentP95, count } ],
         "timedOperationCount": N,        // groups with >= 1 timed sample in [from, to)
         "comparableOperationCount": N,   // groups with >= minSamples in BOTH windows
         "baselineFrom": "ISO-8601" }     // where "usual" starts, so a UI can say so
  timedOperationCount is 0 when no event in the range carries the property; when it is
  non-zero but comparableOperationCount is 0, no group has enough history in the baseline to
  compare against (widen the range — the baseline scales with it up to the cap). The two
  counts let the UI explain an empty list.

GET /api/stats/findings
  Query: from, to, routeProperty? (default Path), methodProperty? (default Method).
         No filter: a findings scan asks what the server noticed, not what you were looking at.
  What the server noticed by itself, most urgent first — no rule, no threshold, no setup. Four
  detectors, all of them compositions of the aggregations above over data already stored:
    went_quiet         a service that logged steadily across the baseline and nothing at all in
                       the window. The one shape an alert rule structurally cannot express: a
                       rule counts what arrived, so it can say "too many" but never "none".
                       now = 0, baseline = events per window it used to send.
    new_exception      an exception type with no occurrence anywhere before the window (baseline
                       is all of history here — a crash last seen in March is a returning crash).
                       now = count = occurrences; baseline = 0.
    failing_route      a route whose share of failed requests rose >= 5 points over its own
                       recent normal, with >= 20 requests in each window. A share, not a count:
                       a route that doubled its traffic doubles its errors with nothing wrong.
                       now/baseline = percent failed; count = errors in the window.
    slower_than_usual  the slow-operations test at its own defaults, over the same trailing
                       baseline that endpoint now uses.
                       now/baseline = p95 in ms; count = samples.
                       Two passes: against the four windows before this one, then — only if that
                       found nothing — the window's own first half against its second. The second
                       pass is what catches an episode that began inside the range, which is the
                       usual case when somebody picks "last hour" and it broke forty minutes ago.
  Baseline for the rate detectors is the 4 windows immediately before [from, to), capped at 24 h
  however wide the window — the same rule as /api/stats/slow-operations, in one place in the code
  (Core/Analysis/Baseline.cs), because "usual" answering two different questions in one product is
  the bug. The cap is both a cost and a correctness bound: four windows of a 24 h
  range is four days, which measured 9.9 s on a 494k-event server — longer than the dashboard's
  10 s live tick, so the band could never settle — and "usual" meaning the last four days is a
  claim any midweek deploy already falsifies.
  200: { "findings": [ { kind, subject, filter, now, baseline, count } ] }, at most 12.
  `filter` opens exactly the events the finding came from, and is what "make this an alert"
  hands to a rule (which no longer needs a saved signal — see ALERTS).
  Nothing is stored: no table, no scan schedule, no dedupe, no acknowledgement. A finding is
  never an alarm — it does not fire a webhook and does not turn the dashboard red. An automatic
  detector produces false positives, and spending an alarm's credibility on them would cost more
  than the detector is worth.

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
  Query: routeProperty? default Path, methodProperty? default Method,
         statusProperty? default StatusCode (all [A-Za-z0-9_.] only),
         limit? default 50, trendBuckets? default 0 (max 120)
  Per-operation RED numbers. An event is grouped as a route when it carries routeProperty
  AND says what happened to the request — either a verb in methodProperty, or a 4xx/5xx code
  in statusProperty. It comes back with route filled and template set to "GET /orders/{id}",
  or to the bare "/orders/{id}" where no verb was logged (method null); anything else falls
  back to its CLEF message_template (method and route null), so jobs and probes stay on the
  list. A request log writes one template for every route it serves, which is why the route
  properties decide the grouping and not the template.
  The outcome is what separates a request from a remark about a path. "Slow request {Path}
  took {Elapsed} ms" carries a 200 and a duration: it is about that path, not about its
  traffic, and grouping it as a route would add a second row under the same name whose p95
  was measured over a different set of events. A line carrying 502 and no verb is the
  opposite — that request ended, and badly — and requiring the verb dropped exactly the
  traffic an operator comes here for: an application logging its failures from an exception
  handler (ordinary in Laravel, Django and Express) put every 5xx in the product into one
  "Request failed {Path}" row while the successes kept their routes. Such rows carry no
  Elapsed, so folding them in cannot move any route's p95.
  Property names differ per sink: Path/Method/StatusCode here, RequestPath/RequestMethod
  under Serilog's ASP.NET middleware, http.route/http.request.method/
  http.response.status_code under OTel.
  Ids are folded out of the path before grouping, so an app that logs the raw path
  ("/api/orders/41973") groups as "/api/orders/{id}" instead of producing one group per
  request. A segment is an id when it is all digits, or a hex/uuid run of 16 characters or
  more; a path that carries no id is passed through byte for byte, which is why an install
  whose sink already logs route templates sees no difference. Measured on 200k events:
  126,267 groups became 12, and the busiest route in the app (59,980 requests, absent from
  the response entirely because each of its rows held one hit) became the top row.
  trendBuckets asks for each row's shape over the window: trend comes back as that many event
  counts, cut on the same bucket arithmetic as /api/stats/histogram, or null when it was not
  asked for. It exists so a table of trend strips costs no requests of its own — the Requests
  page drew one histogram per row, which at fifty rows was fifty round trips that could not
  start until this endpoint had answered. The counts respect `filter`, so a table narrowed to
  5xx gets 5xx-only strips.
  folded says the route holds {id} placeholders this server put there. No event carries that
  text, so a filter built from a folded row has to match the pattern — replace each {id} with
  % and use `like` — while an unfolded row still filters with `=`.
  errorCount counts Error + Fatal levels; p95ElapsedMs is the p95 of the numeric Elapsed
  property, null when no event of the group carried Elapsed. Ordered by total descending.
  200: { "operations": [ { template, total, errorCount, p95ElapsedMs, method, route,
                           folded } ] }

GET /api/stats/user-activity
  Query: property? default UserId ([A-Za-z0-9_.] only), limit? default 50,
         trendBuckets? default 0 (max 120)
  Per-value activity for one user-identifying property: total events, Error + Fatal
  count and last-seen timestamp, grouped by the property (events without it excluded),
  ordered by total descending.
  trendBuckets works exactly as it does on /api/stats/operations: that many event counts
  per row, cut on the same bucket arithmetic as /api/stats/histogram, or null when it was
  not asked for. The Users page draws fifty strips, which was fifty histogram requests
  that could not start until this endpoint had answered.
  200: { "users": [ { value, total, errorCount, lastSeen, trend } ] }

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
                With a session (or on an install with no accounts at all):
                { "status": "ok"|"degraded", "writable": bool, "roomForABatch": bool,
                  "lastWriteFailure": ts|null, "eventCount": n, "dbSizeBytes": n,
                  "freeDiskBytes": n|null }
                With none: { "status": "ok"|"degraded" } and the same status code. The endpoint
                stays open because the container HEALTHCHECK calls it without a session, but
                event count, database size and free disk are capacity facts about someone's
                server and do not belong to whoever can reach the port. The status code is
                unchanged either way — it is what curl -f acts on.
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
