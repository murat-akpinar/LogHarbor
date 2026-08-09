# LogHarbor Repository Map

--- PURPOSE ---

One page that answers "where does this live?" without opening docs/ or grepping the tree.
Area-level on purpose: it names folders and the files that own a whole feature, not every file,
so it stays true as code moves inside those folders.
Read CLAUDE.md for stack and commands, rules.md for how to write the code, this for where to put it.

--- ENTRY POINTS ---

backend/LogHarbor.Api/Program.cs      wires everything: DI, middleware order, endpoint groups,
                                      background workers, static SPA hosting. Start here.
frontend/src/App.tsx                  route table (page <-> URL), providers, auth gate
frontend/src/main.tsx                 React root, nothing else

--- BACKEND: HTTP SURFACE (backend/LogHarbor.Api/Endpoints/) ---

One file per feature group. Handlers stay thin; logic belongs in Core (rules.md).

  /api/events, /api/query/validate  EventEndpoints.cs      search, single event, filter validation
  /api/events/raw                   IngestionEndpoints.cs  CLEF + Seq envelope ingestion
  /v1/logs                          OtlpEndpoints.cs       OTLP logs (protobuf + JSON)
  /v1/traces                        OtlpTraceEndpoints.cs  OTLP traces
  /api/traces/{traceId}             TraceEndpoints.cs      one trace with its spans
  /api/events/export                ExportEndpoints.cs     CSV/JSON download of a search
  /api/stats/*                      StatsEndpoints.cs      every dashboard number (summary, histogram,
                                                           heatmap, top-errors, top-exceptions,
                                                           operations, slow-operations, latency,
                                                           services, service-status, queries,
                                                           user-activity, ingestion-lag,
                                                           ingest-rejections, findings,
                                                           property-values)
  /api/signals                      SignalEndpoints.cs     saved filters
  /api/alerts                       AlertEndpoints.cs      rules, acknowledge
  /api/apikeys                      ApiKeyEndpoints.cs     ingestion keys
  /api/auth                         AuthEndpoints.cs       login, logout, status, password change
  /api/users                        UserEndpoints.cs       accounts (admin/viewer)
  /api/settings                     SettingsEndpoints.cs   archive, redaction, LDAP (+ LDAP test)
  /api/archive                      ArchiveEndpoints.cs    segments, hydrate, forecast
  /api/admin/backup                 BackupEndpoints.cs     database download
  /api/search/suggest               SuggestEndpoints.cs    filter autocomplete
  /healthz                          HealthEndpoints.cs     liveness

  Shared by all of them: Problems.cs (ProblemDetails helpers), RequestBody.cs (size-limited reads),
  Redaction.cs (endpoint-side redaction plumbing).

--- BACKEND: EVERYTHING ELSE IN THE API PROJECT ---

ApiKeyMiddleware.cs           validates the ingestion key, per-key rate limit
IngestRejectionRecorder.cs    records every request that did not end in stored events
Auth/AuthPolicy.cs            which paths bypass the session gate (incl. /swagger)
Auth/AuthService.cs           sessions, cookie, seeded admin, LDAP dispatch
LiveTail/TailHub.cs           SignalR hub clients connect to
LiveTail/TailBroadcaster.cs   pushes newly ingested events, filtered via SQL
LiveTail/TailSubscriptions.cs per-connection active filters
Alerting/AlertScheduler.cs    background timer that evaluates rules
Alerting/HttpWebhookSender.cs webhook delivery
Archiving/ArchiveScheduler.cs background compression + retention + size ceiling
Archiving/HydrationQueue.cs   requests to bring a day back
Archiving/HydrationWorker.cs  does the extraction
Migrations/NNN_*.sql          schema; numbered, run at startup by Core/Storage/MigrationRunner.cs.
                              Never edit a shipped migration — add the next number.
wwwroot/                      the built SPA in production (generated, not source)

--- BACKEND: DOMAIN (backend/LogHarbor.Core/) ---

Events/     Event.cs, ClefParser.cs, SeqRawEventsParser.cs, Otlp/, MessageTemplateRenderer.cs,
            EventRedactor.cs, Levels.cs, TimestampParsing.cs, TraceIds.cs, RoutePath.cs,
            ExceptionLocation.cs, ServiceStatus.cs
            -> parsing the wire formats and deriving fields from a raw event
Query/      QueryTokenizer.cs -> QueryParser.cs -> SqlTranslator.cs (+ SqlLike.cs)
            -> the filter language becomes a parameterized WHERE clause; nothing else builds SQL
               from user input
Storage/    I*Store.cs interfaces + Sqlite*Store.cs implementations, LogHarborDb.cs (connection,
            pragmas), MigrationRunner.cs, row/DTO types, *Settings.cs
            -> the only place that talks to SQLite
Analysis/   FindingScanner.cs, Baseline.cs, Finding.cs -> the findings layer (noticed, not alerted)
Alerting/   AlertEvaluator.cs -> does a rule fire right now
Archiving/  Archiver.cs (Brotli segments), StorageForecast.cs
Auth/       PasswordHasher.cs (PBKDF2), LdapAuthenticator.cs + LdapSettings.cs
Telemetry/  LogHarborMetrics.cs -> the custom meters
Protos/     OTLP .proto definitions

Tests mirror this tree one-to-one: backend/LogHarbor.Tests/<same folder>/.

--- FRONTEND (frontend/src/) ---

pages/          one file per route, composes components, owns no styling of its own
                  /            + /dashboard  DashboardPage
                  /events                    EventsPage       search + live tail
                  /requests                  RequestsPage     HTTP requests view
                  /exceptions                ExceptionsPage
                  /queries                   QueriesPage      slow/frequent queries
                  /services                  ServicesPage     up/down board
                  /users                     UsersPage        user activity
                  /analysis                  AnalysisPage     findings
                  /signals                   SignalsPage
                  /alerts                    AlertsPage
                  /settings                  SettingsPage
                  /send                      SendLogsPage     onboarding snippets
api/            one module per backend area (events, stats, signals, alerts, archive, settings,
                users, traces) over client.ts. Components never fetch directly (rules.md).
hooks/          React Query wrappers + UI state (useEventSearch, useLiveTail, useLiveRange,
                useStats, useAuth, useAlerts, useSignals, useTrace, useUsers, useHealth, ...)
lib/            pure functions, all unit-testable: filter/filterChips, dates/timeRange/timeAxis,
                series/plotScale, levels, status, alerts/alertDurations, findings,
                stackTrace/exceptionLocation, operations, trace, bytes, duration, highlight,
                sendSnippets, suggestContext
components/           shared widgets (NavBar, FilterBar, EventRow, EventDetail, Histogram,
                      Heatmap, Sparkline, StatTile, LoginGate, SpanTimeline, ...)
components/ui/        the design primitives (Card, Panel, Button, Input, Select, Tooltip,
                      States, ...) — new UI reuses these instead of raw Tailwind blocks
components/dashboard/ the dashboard panels (AlarmDeck, FindingsBand, PulsePanel, RoutesPanel,
                      TopErrorsPanel, SlowOpsPanel, ServicesPanel, UsersPanel,
                      ActivityTimeline, IngestionLagStrip, IngestRejectionBanner, ...)
components/settings/  the settings cards (LdapCard, RedactionCard, UsersCard, SettingsTabs)
components/detail/    event detail internals (PropertyRows, StackTrace, CopyButton)
i18n/           en.ts + tr.ts string tables, index.tsx provides the hook. Every user-visible
                string goes in both files.
types/index.ts  shared TS types mirroring the API DTOs

Tests sit next to their subject: Foo.tsx + Foo.test.tsx.

--- OUTSIDE THE SERVER ---

tools/deploy.sh          ship to the test server (the only supported deploy path)
tools/service-probe/     host-side systemd probe that POSTs up/down as ordinary events
test/                    test tooling, not shipped: traffic-sim, anomaly-test, load-char,
                         db-query-sim, perf-check, readme-tour (gif), ldap_test, scripts
docker-compose.yml       single service, one volume at data/
Dockerfile               frontend build + backend publish into one image
UI/, images/             screenshots used by README

--- WHICH DOC ANSWERS WHICH QUESTION ---

running-in-5-minutes.md  I just want a first log line
architecture.md          how the pieces fit, config keys, data flow
data-model.md            tables, event schema, what a migration must respect
api.md                   request/response shape of every endpoint
query-language.md        the filter syntax users type
frontend.md              UI structure, pages, conventions
ingestion-app.md         sending from an app (Seq sinks work unchanged)
ingestion-docker.md      collecting from existing containers (Vector)
ingestion-otlp.md        OpenTelemetry
archiving.md             compression, hydration, retention, size ceiling
service-status.md        up/down via tools/service-probe
ldap.md                  directory sign-in
redaction.md             property values ingestion refuses to keep
superpowers/plans/       dated design/implementation plans, one per feature — why a thing
superpowers/specs/       was built the way it was, when the code alone does not say

--- CHANGE HERE, THEN THERE ---

New/changed endpoint      Endpoints/*.cs -> docs/api.md -> frontend/src/api/*.ts -> types/index.ts
New table or column       Migrations/NNN_*.sql -> Core/Storage -> docs/data-model.md
New filter syntax         Core/Query -> docs/query-language.md -> frontend/src/lib/filter.ts
New page                  pages/ -> App.tsx route -> NavBar -> i18n en.ts + tr.ts -> docs/frontend.md
New config key            appsettings.json -> docs/architecture.md CONFIGURATION
New user-visible string   i18n/en.ts and i18n/tr.ts, both, always
Any of the above          todo.md item marked ✔ only after dotnet test + npm run test pass
