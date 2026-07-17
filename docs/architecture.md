# LogHarbor Architecture

--- OVERVIEW ---

LogHarbor is a self-hosted structured log server modeled after Seq.
Clients (apps using Serilog, NLog, Winston, etc.) POST structured events over HTTP.
LogHarbor stores them in SQLite and serves a React SPA for search, live tail, and dashboards.

--- SYSTEM DIAGRAM ---

[Client apps] --CLEF/JSON over HTTP--> [Ingestion API] --> [Event Store (SQLite)]
                                            |                     |
                                            v                     v
                                      [SignalR Hub] <---- [Query Engine]
                                            |                     |
                                            +-----> [React SPA] <-+

--- COMPONENTS ---

Ingestion API:
  POST /api/events/raw, accepts CLEF (newline-delimited JSON)
  Validates API key, parses events, writes batch to store, broadcasts to live tail
  Wire-compatible with Seq (same path, same body, X-Seq-ApiKey accepted as a header alias),
  so existing Seq sinks ingest into LogHarbor unchanged (docs/ingestion-app.md)
  POST /v1/logs accepts OTLP/HTTP (OpenTelemetry logs) in protobuf and JSON
  encodings — standard path, so OTEL_EXPORTER_OTLP_ENDPOINT pointed at LogHarbor
  works with any OTel SDK or Collector (docs/ingestion-otlp.md); same API-key
  gate and rate limits as CLEF

Event Store:
  SQLite (WAL mode) with JSON1 for property queries and FTS5 for full-text message search
  Append-heavy writes, indexed on timestamp and level
  Single writer: concurrent ingestion requests serialize on the write lock
  (busy_timeout 5s absorbs bursts); if ingestion volume ever outgrows this,
  funnel writes through one background channel — not needed for V1

Archive Engine:
  Compresses events older than CompressAfterDays into daily Brotli segments (docs/archiving.md)
  Hydrates segments back into a cache table on demand, evicts after HydrationKeepDays
  Retention deletes archive segments older than RetentionDays

Query Engine:
  Parses the LogHarbor filter language (docs/query-language.md) into SQL
  Powers search page, signals, and dashboard aggregations

SignalR Hub:
  Pushes newly ingested events to connected browsers (live tail)
  Clients subscribe with an optional active filter
  Matching runs as SQL over the just-inserted ids (reuses the query translator;
  a separate in-memory evaluator would silently drift from SQL semantics)
  Requires the admin session cookie when auth is enabled

Web API:
  REST endpoints for search, signals, API keys, dashboard queries (docs/api.md)
  Swagger UI at /swagger (development only)

Auth:
  Multi-user accounts (admin / viewer roles), PBKDF2-hashed passwords, session cookie
  First start seeds an admin account, so an install is never left open: LOGHARBOR_ADMIN_PASSWORD
  when set, otherwise admin/admin flagged must-change — that session is refused everywhere
  except /api/auth until it sets a real password (docs/api.md AUTH)
  Ingestion is unaffected: it authenticates by API key, not by session
  Login and password-change endpoints rate limited against brute force

React SPA:
  Served as static files by the backend in production
  Vite dev server with proxy during development (docs/frontend.md)

--- BACKEND PROJECTS ---

LogHarbor.Api:   ASP.NET Core host, endpoints, SignalR hub, migrations, static SPA hosting
LogHarbor.Core:  domain types, stores, CLEF parser, query language parser, retention
LogHarbor.Tests: xUnit tests for Core and Api

--- DATA FLOW: INGESTION ---

1. Client POSTs CLEF batch to /api/events/raw with X-LogHarbor-ApiKey (or X-Seq-ApiKey) header
2. ApiKeyMiddleware validates the key
3. ClefParser parses each line into an Event
4. EventStore.WriteBatch inserts events in one transaction
5. Hub broadcasts events to live-tail subscribers
6. API returns 201

--- DATA FLOW: SEARCH ---

1. SPA sends GET /api/events?filter=...&from=...&to=...&count=...
2. QueryParser turns the filter string into a SQL WHERE clause + parameters
3. EventStore executes, returns newest-first page
4. SPA renders rows; expanding a row shows full properties

--- CONFIGURATION ---

appsettings.json keys:
  LogHarbor:DatabasePath                -> SQLite file location (default: data/logharbor.db)
  LogHarbor:RetentionDays               -> delete archive segments older than N days (default: 365);
                                       when archiving is disabled (CompressAfterDays=0), deletes
                                       hot events directly so the db never grows unbounded
  LogHarbor:MaxBatchBytes               -> max ingestion payload size (default: 5 MB)
  LogHarbor:MaxEventBytes               -> max size of a single event (default: 256 KB)
  LogHarbor:IngestRateLimitPerMinute    -> per-API-key ingestion rate limit (default: 1200)
  LogHarbor:LoginRateLimitPerMinute     -> per-IP login attempt limit (default: 10)
  LogHarbor:Archive:CompressAfterDays   -> compress events older than N days (default: 90, 0 = off)
  LogHarbor:Archive:HydrationKeepDays   -> evict extracted data after N days unused (default: 1)
  LogHarbor:ArchivePath                 -> segment directory (default: archive/ next to the database)
  LogHarbor:SeedDefaultAdmin            -> seed the first admin account when the user table is
                                       empty (default: true; admin/admin, must-change)
Archive values are defaults only: values saved from the Settings page (stored in the
settings table) take precedence at runtime.
Environment only (secrets):
  LOGHARBOR_ADMIN_PASSWORD              -> password for the seeded admin account (optional;
                                       without it, admin/admin must be changed at first login)

--- DEPLOYMENT MODEL ---

Single process, single container (modular monolith, like Seq itself)
Frontend build served as static files by the backend
Docker: one image, one volume mounted at data/ for the SQLite file
Layered code (Api/Core + store interfaces) keeps a future split possible, not planned for V1

--- NON-GOALS (V1) ---

Microservices / clustering / multi-node
Multi-user accounts and roles (single admin password only)
Log file tailing agents (HTTP ingestion only; use Vector, docs/ingestion-docker.md)
