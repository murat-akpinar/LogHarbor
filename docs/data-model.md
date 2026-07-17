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
@tr        ->  trace_id (lowercased)
@sp        ->  span_id (lowercased)
other keys ->  properties JSON

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
trace/span: @tr and @sp are lowercased on ingest. W3C ids are lowercase hex and
  OTLP ingestion stores the same canonical form, so @TraceId filters exact-match.
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

--- SETTINGS ---

Key/value store for runtime-changeable settings; value is JSON.
Today only the 'archive' key exists (compressAfterDays, hydrationKeepDays,
retentionDays); saved values override appsettings.json defaults.

--- RETENTION & ARCHIVING ---

Daily archive job: events older than CompressAfterDays -> Brotli daily segments,
rows removed from events table (docs/archiving.md).
Hourly eviction: events_cache rows unused for HydrationKeepDays deleted.
Retention: archive segments older than RetentionDays deleted (file + row).
PRAGMA incremental_vacuum after deletions.

--- PROPERTY QUERIES ---

Structured property filters use SQLite JSON1:
filter "UserId = 42" -> WHERE json_extract(properties, '$.UserId') = 42
