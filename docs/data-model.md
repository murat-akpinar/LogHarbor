# LogHarbor Data Model

--- EVENT ---

The core entity. One structured log entry.

Field           Type        Notes
id              INTEGER     autoincrement primary key
timestamp       TEXT        UTC ISO-8601, from client (@t), indexed
level           TEXT        Verbose | Debug | Information | Warning | Error | Fatal, indexed
message         TEXT        rendered message (template with properties substituted)
message_template TEXT       raw template, e.g. "User {UserId} logged in"
properties      TEXT        JSON object of structured properties (@ prefixed keys removed)
exception       TEXT        nullable, full exception text (@x)
ingested_at     TEXT        UTC ISO-8601, server clock
trace_id        TEXT        nullable, W3C trace id (lowercase hex), from @tr; indexed (partial)
span_id         TEXT        nullable, W3C span id (lowercase hex), from @sp

--- CLEF MAPPING ---

CLEF key   ->  Event field
@t         ->  timestamp (required)
@l         ->  level (default: Information)
@m         ->  message (rendered)
@mt        ->  message_template
@x         ->  exception
@tr        ->  trace_id (validated + lowercased)
@sp        ->  span_id (validated + lowercased)
other keys ->  properties JSON

--- SEQ RAW EVENTS MAPPING ---

The {"Events":[...]} envelope some Seq sinks send (docs/ingestion-app.md) lands on the
same fields, so an event is indistinguishable once stored:

Events[] key    ->  Event field
Timestamp       ->  timestamp (required)
Level           ->  level (default: Information, same alias map)
Message         ->  message (rendered)
MessageTemplate ->  message_template
Exception       ->  exception
Properties.*    ->  properties JSON (the bag verbatim, re-serialized compact)
Renderings, EventType -> dropped; trace_id/span_id are null, the format carries no
                         trace ids (a TraceId property stays an ordinary property)

--- INGEST REJECTIONS ---

What ingestion refused, so a client whose events never arrive can be found without a packet
capture (docs/api.md GET /api/stats/ingest-rejections).

Field          Type      Notes
api_key_id     INTEGER   0 when the request carried no valid key (a 401 has nothing to join)
reason         TEXT      unauthorized | rate_limited | invalid_payload | too_large |
                         unsupported_media_type
day            TEXT      UTC yyyy-MM-dd
request_count  INTEGER   requests in this bucket, not events — a rejected batch is unparsed,
                         so how many events it held is unknown
first_seen     TEXT      UTC ISO-8601, when the bucket opened
last_seen      TEXT      UTC ISO-8601, most recent rejection
last_detail    TEXT      nullable, the server's message, capped at 200 chars

One row per (api_key_id, reason, day), upserted: a misconfigured client retries forever and
the record of the problem must not outgrow the log data. Kept 30 days by the archive
scheduler's daily pass — deliberately not RetentionDays, which users shorten to save disk
and which would then erase the evidence that a client has been failing all week.

--- INGESTION NORMALIZATION ---

timestamp: @t parsed as DateTimeOffset, converted to UTC, stored as fixed-width
  "yyyy-MM-ddTHH:mm:ss.fffffffZ" so string comparison == chronological comparison
  (offsets like +03:00 and varying precision would break range filters otherwise).
  Unparseable @t -> line rejected (400 with line number).
  @t more than 5 min in the future -> clamped to server time; a client with a
  broken clock must not create rows that never age into the archive.
level: @l mapped case-insensitively to the six canonical levels:
  trace -> Verbose, info -> Information, warn -> Warning, err -> Error,
  critical/crit -> Fatal; unknown values -> Information.
  Without this, Vector/Winston-style levels fragment filters and the histogram.
trace/span: @tr and @sp are validated on ingest — 32/16 hex chars, not all-zero
  (the W3C invalid value) — and lowercased; anything else stores as NULL rather
  than rejecting the event, the same contract as the OTLP path, so @TraceId
  filters exact-match across both ingestion routes.
OTLP: /v1/logs events go through the same normalization; the full
  LogRecord -> Event mapping table lives in docs/ingestion-otlp.md.

--- SQLITE SETUP (MIGRATION RUNNER, ORDER MATTERS) ---

PRAGMA auto_vacuum=INCREMENTAL  -- MUST run before the first table is created;
                                -- cannot be enabled later without a full VACUUM.
                                -- Archiving relies on incremental_vacuum to reclaim space.
PRAGMA journal_mode=WAL         -- readers never block the writer (search + live tail + ingest)
PRAGMA synchronous=NORMAL       -- safe with WAL, much faster than FULL
PRAGMA busy_timeout=5000        -- concurrent ingestion requests serialize on the write lock

--- SQLITE SCHEMA ---

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  message_template TEXT,
  properties TEXT,
  exception TEXT,
  ingested_at TEXT NOT NULL,
  trace_id TEXT,
  span_id TEXT
);
CREATE INDEX ix_events_timestamp ON events(timestamp);
CREATE INDEX ix_events_level ON events(level, timestamp);
CREATE INDEX ix_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;

AUTOINCREMENT is deliberate: it forbids rowid reuse, so new hot events can never
collide with original ids preserved in archive segments (docs/archiving.md).
Do not "optimize" it away.

CREATE VIRTUAL TABLE events_fts USING fts5(
  message, exception, content='events', content_rowid='id'
);
Triggers keep events_fts in sync on insert/delete.

--- SIGNAL ---

A saved, named filter.

Field       Type      Notes
id          INTEGER   primary key
title       TEXT      unique, e.g. "Errors", "Slow requests"
filter      TEXT      LogHarbor filter expression
created_at  TEXT      UTC ISO-8601

--- API KEY ---

Field       Type      Notes
id          INTEGER   primary key
title       TEXT      e.g. "OrderService production"
token_hash  TEXT      SHA-256 of the token; raw token shown once at creation
created_at  TEXT      UTC ISO-8601
is_active   INTEGER   0/1, revoke by setting 0

--- USER ---

An account that can sign in to the UI/management API (docs/api.md AUTH).

Field                Type      Notes
id                   INTEGER   primary key
username             TEXT      unique, case-insensitive
password_salt        TEXT      base64
password_hash        TEXT      base64, PBKDF2-SHA256 (LogHarbor.Core PasswordHasher)
role                 TEXT      admin | viewer
created_at           TEXT      UTC ISO-8601
must_change_password INTEGER   0/1; set on the seeded admin/admin account, cleared by
                               POST /api/auth/password. While 1, the session is refused
                               everywhere behind the auth gate (docs/api.md AUTH)

--- ALERT RULE ---

Fires a webhook when a signal matches at least threshold_count events within
window_minutes (docs/api.md ALERTS). Evaluated by a once-a-minute background job.

Field              Type      Notes
id                 INTEGER   primary key
title              TEXT      unique
signal_id          INTEGER   references signals(id)
threshold_count    INTEGER
window_minutes     INTEGER
webhook_url        TEXT      absolute http(s) URL
is_enabled         INTEGER   0/1
created_at         TEXT      UTC ISO-8601
last_triggered_at  TEXT      nullable, set after each firing attempt (success or failure)
last_error         TEXT      nullable, last webhook/evaluation error, cleared on next success

--- SPAN ---

One OTLP span (docs/ingestion-otlp.md, /v1/traces). Trace-scoped: read only by
trace_id for the waterfall, so no FTS. Ids are lowercase W3C hex.

Field            Type      Notes
id               INTEGER   primary key (autoincrement)
trace_id         TEXT      32 hex; indexed (ix_spans_trace)
span_id          TEXT      16 hex
parent_span_id   TEXT      16 hex, nullable (null = root span)
name             TEXT
kind             TEXT      internal | server | client | producer | consumer | unspecified
service          TEXT      resource service.name, nullable
start_timestamp  TEXT      UTC ISO-8601; indexed (ix_spans_start, for retention)
duration_ms      REAL      (end - start) in ms, 0 when unknown
status_code      TEXT      unset | ok | error
status_message   TEXT      nullable
attributes       TEXT      JSON object, nullable
ingested_at      TEXT

Spans are never archived; retention deletes rows older than RetentionDays by
start_timestamp (regardless of the archive on/off setting).

--- ARCHIVE SEGMENT ---

Compressed daily chunk of old events (docs/archiving.md).

Field              Type      Notes
day                TEXT      'YYYY-MM-DD', primary key
file_path          TEXT      file name inside the archive directory
event_count        INTEGER
size_bytes         INTEGER   compressed file size
uncompressed_bytes INTEGER   exported JSONL size (compression-ratio stat)
status             TEXT      cold | hydrating | hydrated
hydrated_at        TEXT      nullable
last_accessed_at   TEXT      nullable

events_cache: same columns as events (including trace_id/span_id) + segment_day TEXT (hydrated data, transient);
has its own FTS table events_cache_fts so free-text search covers hydrated data

--- DATABASE SIZE SAMPLE ---

One reading of the database file length, written by the hourly maintenance pass
after the size cap has run — so the series follows the file the operator actually
has, not the peak before maintenance cut it back.

Field       Type      Notes
taken_at    TEXT      UTC ISO-8601, primary key
size_bytes  INTEGER

Kept 14 days (pruned on the daily tick, independent of RetentionDays: the series is
an operational trail, and shortening retention to save disk must not erase the
evidence of what the disk has been doing). GET /api/archive/forecast fits the last
7 days of it (docs/archiving.md).

--- SETTINGS ---

Key/value store for runtime-changeable settings; value is JSON.
Two keys today; saved values override appsettings.json defaults.
  archive  compressAfterDays, hydrationKeepDays, retentionDays, maxDatabaseBytes
  ldap     directory sign-in (docs/ldap.md): enabled, host, port, security, baseDn,
           upnSuffix, userDnPattern, adminGroup, viewerGroup, nestedGroups,
           allowInvalidCertificate. No password: LogHarbor binds as the user
           signing in, so there is nothing secret to store. A new key rather than a
           migration, which is the point of this table.

--- RETENTION & ARCHIVING ---

Daily archive job: events older than CompressAfterDays -> Brotli daily segments,
rows removed from events table (docs/archiving.md).
Hourly eviction: events_cache rows unused for HydrationKeepDays deleted.
Retention: archive segments older than RetentionDays deleted (file + row).
PRAGMA incremental_vacuum after deletions.

--- PROPERTY QUERIES ---

Structured property filters use SQLite JSON1:
filter "UserId = 42" -> WHERE json_extract(properties, '$.UserId') = 42
