# LogHarbor

[![License: GPL v3](https://img.shields.io/badge/license-GPL%20v3-1a1a1a?style=flat-square&labelColor=1a1a1a&color=8a6f3a)](LICENSE)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-1a1a1a?style=flat-square&labelColor=1a1a1a&color=d8b66b)](https://claude.com/claude-code)
[![Status](https://img.shields.io/badge/status-active-1a1a1a?style=flat-square&labelColor=1a1a1a&color=4a9e6b)](https://github.com)
[![.NET](https://img.shields.io/badge/.NET-8.0-1a1a1a?style=flat-square&labelColor=1a1a1a&color=512bd4)](https://dotnet.microsoft.com)
[![React](https://img.shields.io/badge/React-18-1a1a1a?style=flat-square&labelColor=1a1a1a&color=61dafb)](https://react.dev)
[![SQLite](https://img.shields.io/badge/SQLite-JSON1%20%2B%20FTS5-1a1a1a?style=flat-square&labelColor=1a1a1a&color=003b57)](https://www.sqlite.org)
[![Docker](https://img.shields.io/badge/docker-ready-1a1a1a?style=flat-square&labelColor=1a1a1a&color=2496ed&logo=docker&logoColor=fff)](https://www.docker.com)

Self-hosted structured log server, inspired by [Seq](https://datalust.co/seq).
Ingests structured log events (CLEF/JSON), stores them in a single SQLite file, and
serves a web UI for search, live tail, dashboards and alerts.

*[Türkçe README](README_TR.md)*

**New here?** [Running in 5 minutes](docs/running-in-5-minutes.md) — start the
container, sign in, create a key, see your first log line on screen.

- **Search** with a Seq-like filter language (`@Level = 'Error' and Elapsed > 500`)
- **Live tail** over SignalR, filtered server-side
- **Signals**: saved filters you can toggle on
- **Dashboard**: level histogram, summary cards, activity heatmap
- **Analysis**: top errors grouped by message template, top exception types, and
  operations slower than their own p95 baseline
- **Services**: per-service RED overview (event rate, error %, p95) straight from the logs
- **Lens pages**: the same data read four ways — Requests (endpoints + status codes),
  Exceptions (live feed with source location), Queries (SQL by cost), Users (activity per id)
- **Traces**: follow one request across services; OTLP spans render as a waterfall
- **Alerts**: webhook when a signal matches N events — or a dead man's switch when one
  goes silent; Slack / Discord / generic payloads
- **Archive**: old events compressed to daily Brotli segments, hydrated back on demand
- **Seq wire-compatible**: existing Seq sinks ingest into LogHarbor unchanged — both of
  Seq's body formats, verified against the real Serilog, winston-seq and seqlog clients
- **No silent drops**: every ingestion request LogHarbor refuses is counted, logged and
  shown, so a misconfigured client cannot lose events unnoticed
- Single process, single container, one SQLite file

---

## Quick start (Docker)

```bash
docker compose up -d
```

or without compose:

```bash
docker build -t logharbor .
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data logharbor
```

Open http://localhost:5000 and sign in with **admin / admin**. LogHarbor immediately asks for a
new password and refuses every other request until you set one, so the default never survives
first contact. Then go to **Settings** and create an API key — the token is shown **once**.

No environment variable, no `.env`, no open instance. If you would rather pick the password up
front (unattended deploys), set it and skip the change prompt:

```bash
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data \
  -e LOGHARBOR_ADMIN_PASSWORD='your-password' logharbor
```

Either way the `admin` account is seeded on first start only; further accounts (`admin` /
`viewer` roles) are managed on the Settings page. Ingestion always uses API keys and is
unaffected by any of this.

If you have an Active Directory or LDAP server, people can sign in with their domain
account instead — group membership decides whether they are an admin or a viewer, and no
account is created in LogHarbor first. It is configured on the Settings page, not in a file:
see [docs/ldap.md](docs/ldap.md).

### Testing over plain HTTP (home / LAN)

In production LogHarbor runs behind an HTTPS reverse proxy, so outside development the session
cookie is issued with `Secure`. Reaching it over plain HTTP at **a LAN address** like
`http://192.168.1.50:5000` then breaks login: the client drops the `Secure` cookie, the
sign-in never sticks, and you land back on the login screen instead of the change-password
step (even though **admin / admin** is correct). Measured on a fresh install — the login call
answers `200`, the cookie is never stored, and the next request is unauthenticated.

`http://localhost:5000` is the exception, not an example of the problem: loopback counts as a
trustworthy origin, so browsers and command-line clients keep a `Secure` cookie there and
login works without any of this.

For HTTP testing, opt out explicitly with `LogHarbor__AllowInsecureCookie=true`. With `docker run`:

```bash
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data \
  -e LogHarbor__AllowInsecureCookie=true logharbor
```

Or add it to the `environment:` block in `docker-compose.yml`, then `docker compose up -d`:

```yaml
    environment:
      - LogHarbor__AllowInsecureCookie=true
```

Now log in with **admin / admin** over HTTP and set a new password when prompted. Leave this off
(the default) whenever a reverse proxy terminates TLS in front of LogHarbor — the cookie must
stay `Secure` there. It is a testing convenience, not for anything exposed beyond a trusted LAN.

## Quick start (from source)

Requires .NET 8 SDK and Node 22+.

```bash
# terminal 1 — backend on :5000 (Swagger UI at /swagger, behind the admin session)
dotnet run --project backend/LogHarbor.Api

# terminal 2 — frontend dev server on :5173, proxies /api and /hubs to the backend
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173** — not :5000. The backend serves the SPA bundle committed
under `backend/LogHarbor.Api/wwwroot`, which is only as new as the last time someone
rebuilt it, so :5000 can show you an older UI than the source you just cloned. The Docker
image has no such problem: it builds the frontend in its own stage. The database lands in
`backend/LogHarbor.Api/data/` unless `LogHarbor__DatabasePath` says otherwise.

Sign in with **admin / admin** and set a new password when prompted, exactly as in the
Docker path above.

Tests:

```bash
dotnet test backend
cd frontend && npm run build && npm run lint
```

---

## The web UI

Everything sits behind the login gate. The top bar carries the page nav plus an EN/TR
language toggle and a light/dark theme toggle.

**Two controls behave the same on every page that has a time dimension** (Dashboard, Events,
Requests, Exceptions, Queries, Services, Users, Analysis), top right:

```
[ ● Live ]  |  [ Last hour ▾ ]
```

- **Live** keeps a rolling window and refreshes every 10 s. On the Dashboard and the three
  lens pages it is on by default over the last hour; on Services, Users and Analysis it is off
  and their window is 24 h. On Events, Live is a real socket subscription (SignalR) and the dot
  shows the connection: green connected, amber connecting, red dropped.
- **Time range** picks a preset or a custom from/to. Choosing one leaves Live — an explicit
  window and "now" contradict each other — so the pair never shifts under your cursor.

Level colour is consistent everywhere, in badges, charts and chips: Verbose violet, Debug cyan,
Information blue, Warning amber, Error red, Fatal rose.

### Dashboard (`/`)

The page to leave open on a second monitor. Four sections: **Activity** (Events and Errors
cards — a big figure, its breakdown and a stacked histogram each), **Analysis** (top errors,
top exceptions, slowest operations), **Services & users**, and an **hour-of-day × day-of-week
heatmap** that shows when your system is actually busy.

Click a histogram bar to open Events for that slice; drag across the histogram to zoom into a
narrower window (that also pauses Live). Every card links to the page it summarises.

One panel appears only when it has something to say: **Ingestion rejected**, at the top, for
requests LogHarbor turned away in the last 7 days. Those events are not in any chart below —
they were never stored — so this is the one place they show up.

### Events (`/events`)

The stream itself, and where you end up from every deep link.

- **Search bar** takes the [filter language](#query-language) and validates on submit;
  it autocompletes property names and values as you type, and remembers your last 10 filters.
- **Level chips** narrow to one or more levels. Everything right of the `|` is your saved
  **Signals** — toggling them ANDs them into the filter.
- **The list** is virtualised and pages by keyset, so scrolling stays smooth at any depth.
  With Live on, new events prepend with a highlight; scrolling down pauses the prepend and a
  banner counts what is waiting.
- **Click a row** for the detail panel: identity chips that filter on click, a property tree
  (nested values collapse) with per-property filter/copy, the exception with its source
  location, "events around this" (±2 min), and the raw JSON collapsed at the bottom.
  If the event carries a trace id, **View trace** replaces the filter with `@TraceId = '…'` and
  draws the request as a waterfall — real OTLP spans when you send them, inferred from log
  timestamps when you don't.
- **Columns** adds any property as a list column, **Time** switches absolute/relative stamps,
  **Export** downloads the current filter + range as JSON or CSV.
- **Keyboard**: `/` focus search, `j`/`k` move the selection, `Esc` close the panel, `?` help.

### Requests (`/requests`)

HTTP endpoints as a RED table: events/min, error %, p95 `Elapsed` and a trend sparkline per
operation, sortable by any of them. Above it, a stacked **status-code chart** (1/2/3xx, 4xx,
5xx) with an hour axis and a hover tooltip; clicking a legend chip isolates one class and
narrows the table with it. Rows deep-link to the matching Events search.

Feed it by logging `StatusCode` and `Elapsed` on your request-completed event — ASP.NET Core
and most frameworks do this out of the box.

Rows are grouped by route, and ids are folded out of the path first, so an app that logs
`/api/orders/41973` still reads as one `/api/orders/{id}` row rather than one row per order.
That matters more than it sounds: without it the busiest route in an application disappears
from the table entirely, shattered across thousands of one-hit rows, while its p95 is measured
over the two or three requests that happened to share an id.

### Exceptions (`/exceptions`)

A live feed grouped by exception type: count, trend, first and last seen, and **Source** —
the `path:line` parsed out of the latest stack trace (.NET, PHP, Python and Node formats).
Expand a row and the latest occurrence opens inline, together with the other events of its
trace, so you read the failure in context instead of hunting for it.

### Queries (`/queries`)

Your database work, grouped by SQL text: calls, total time, average and p95 per statement on
the left; pick one and the right pane shows the full SQL, stat tiles, the connection, its
trend and recent occurrences, with a link into Events.

It reads EF Core's `Executed DbCommand` shape by default; if your logger names things
differently, change the property names (`commandText` / `elapsed`) at the top of the page.

### Services (`/services`)

One row per service, identified by `service.name` (OTLP) or `Service` (CLEF/Seq): event rate,
error %, p95 `Elapsed`, trend. The quickest answer to "which service is having a bad day".

Above it, a **status board** for the host's own services — systemd units and Docker containers —
if you installed [`tools/service-probe`](docs/service-status.md) on a machine. One tile per
service: green up, red down, amber unhealthy or no heartbeat, grey "the probe could not tell".
Click one to read that service's whole up/down timeline in Events. No probe, no board.

### Users (`/users`)

This page is about the people appearing *in your logs*, not the accounts that sign in to
LogHarbor — those live under Settings, and a directory user has no row there at all.

The same shape, per user: events, errors, last seen, trend. `UserId` is the default grouping
property — type another one (`TenantId`, `AccountId`, …) to regroup. Deep links handle numeric
and string ids correctly.

### Analysis (`/analysis`)

Three questions on one page:

- **Top errors** grouped by message template, so `Order {OrderId} failed` is one row no matter
  how many order ids it rendered.
- **Top exception types**, with a `new` badge on anything first seen inside the range.
- **Slower than usual** — operations whose p95 in this window regressed past their own
  baseline from before it. This is the one that finds a slowdown nobody reported yet.

### Signals (`/signals`)

Saved filters, validated when you save them. They are toggles on the Events page and the input
to alert rules — anything you can type in the search bar can become one.

### Alerts (`/alerts`)

A rule is a signal plus a condition plus a webhook, evaluated once a minute:

- **at-least** — fire when the signal matches N events within the window.
- **silence** (dead man's switch) — fire when a signal that *was* alive produces nothing for a
  whole window. This is what watches heartbeats: a service that stops logging, a probe that
  dies, a host that goes away.

Payload format is Slack, Discord or generic JSON — paste an incoming-webhook URL and pick the
matching one. After firing, a rule cools down for one window, so a broken webhook is not
hammered every minute.

### Settings (`/settings`)

API keys (create, copy once, revoke), users and roles, health and database size, a one-click
database backup, and the archive section: how long before events are compressed, how long
extracted data is kept, when archives are deleted — plus the list of archived days with an
**Extract** button on each, which is how you bring a compressed day back into search.

Two derived lines sit under those fields. One spells out the time policy as a sentence
(`hot 0–1 d → compressed 1–7 d → deleted after 7 d`). The other turns the size ceiling into
a date: the hourly maintenance pass records the database size, and the page reports how fast
the file is growing and how many days of room are left before the oldest day starts being
dropped. A new install says it is still measuring rather than guessing from one reading.

The last card is directory sign-in (LDAP / Active Directory): server, base DN, how the
username becomes a bind, and the two groups that map to admin and viewer. Nothing secret is
stored — LogHarbor binds as the person signing in — and a **Test** button asks the directory
about one username and password and shows the groups it returned and the role they earn,
without creating a session. Press it: a base DN one level too deep or a group spelled
differently in your domain is otherwise invisible until someone tries to sign in, and then it
is a 401 with no reason attached. Details in [docs/ldap.md](docs/ldap.md).

Full UI reference: [docs/frontend.md](docs/frontend.md).
---

## Sending logs

Three independent routes; run any or all of them.

### From inside your app — structured properties

LogHarbor's ingestion endpoint is wire-compatible with Seq: same path, both of Seq's body
formats (CLEF and the `{"Events":[...]}` envelope), and `X-Seq-ApiKey` is accepted alongside
`X-LogHarbor-ApiKey`. So **point an existing Seq sink at LogHarbor and it works** — with its
batching, retry and buffering included.

Serilog (.NET), `dotnet add package Serilog.Sinks.Seq`:

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Seq("http://localhost:5000", apiKey: Environment.GetEnvironmentVariable("LOGHARBOR_API_KEY"))
    .CreateLogger();

Log.Error(ex, "Order {OrderId} failed for {Customer}", 123, "acme");
```

`OrderId` and `Customer` become queryable fields, and every `Order {OrderId} failed` event
groups as one error on the Analysis page regardless of the id.

`seqlog` (Python) and `@datalust/winston-seq` (Node) work the same way. Their snippets live
in [docs/ingestion-app.md](docs/ingestion-app.md) — read them rather than guessing, because
both have gotchas that lose events silently.

#### What is actually verified

Each sink below was pointed at a running LogHarbor, sent one structured event, and the
stored row read back. Repeatedly, on purpose: a batching sink that delivers once and drops
the next four is the failure mode here, and a single green run does not distinguish the two.

| SDK | Sends | Verified | Watch out for |
|---|---|---|---|
| `Serilog.Sinks.Seq` (.NET) | CLEF | 3 / 3 | `Log.CloseAndFlush()` before a short process exits |
| `@datalust/winston-seq` (Node) | `Events` envelope | 5 / 5 | ESM only — `import`, not `require`; `logger.close()` does **not** drain the transport, `await transport.flush()` does |
| `seqlog` (Python) | `Events` envelope | 5 / 5 | needs a named `getLogger()`, not `logging.error()`; the flush is async, so the process must outlive it (`logging.shutdown()` alone loses the event) |
| `NLog.Targets.Seq` (.NET) | CLEF | not tested | same `serverUrl` + `apiKey` settings; expected to work, but that is reasoning, not a result |

All three verified sinks produce the same row: level `Error`, the template preserved for
grouping, and `OrderId` / `Customer` as queryable properties.

#### When nothing arrives

A rejected sink looks exactly like a sink with nothing to say. Most of them swallow the
error — that is correct, logging must not throw into your app — so the app runs fine and the
events simply are not there.

LogHarbor records every ingestion request it turns away, so there is somewhere to look:
a red panel at the top of the Dashboard (shown only when there is something to show), the
same data at `GET /api/stats/ingest-rejections`, and a warning per rejection in the server
log. It names the API key, the reason, how many requests, and the last error — usually
enough to identify the broken client without touching it.

Nothing there at all means the requests never reached LogHarbor: wrong URL or port, a proxy
in between, or the sink never flushed.

Anything else: POST newline-delimited CLEF yourself.

```bash
curl -X POST http://localhost:5000/api/events/raw \
  -H "X-LogHarbor-ApiKey: logharbor_your_token_here" \
  -H "Content-Type: application/vnd.serilog.clef" \
  --data-binary "{\"@t\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"@l\":\"Error\",\"@mt\":\"Order {OrderId} failed\",\"OrderId\":123}"
```

Stamp `@t` with the current time, as above. It is the event's own timestamp and every
time-ranged view is a window over it, so a fixed date pasted from a page like this one is
accepted with `201` and then sits outside the rolling last hour the UI opens on — the event
is stored and invisible, which is a confusing way to start.

### OpenTelemetry (OTLP)

Any OTel SDK or Collector can send logs directly — no Seq sink needed:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5000
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<your-key>
```

Both protobuf and JSON encodings are accepted on `/v1/logs`, and OTLP traces on
`/v1/traces` (spans render as the trace waterfall on the Events page). See
[docs/ingestion-otlp.md](docs/ingestion-otlp.md) for the Collector config and
the full field mapping.

### From Docker containers — no app changes

Run one Vector container per host. It reads every container's stdout/stderr and ships it to
LogHarbor, tagged with the compose project and service name, so `App = 'shop-api'` and
`Service = 'backend'` work with no per-project configuration. Log lines arrive as text
rather than structured fields — the trade for touching nothing.

Setup: [docs/ingestion-docker.md](docs/ingestion-docker.md).

### Service status (up/down)

"Is nginx up?" needs no uptime subsystem: a small probe on the host runs
`systemctl is-active` / `docker inspect` once a minute and sends the answer as a normal
log event (`up` = 1 or 0, tagged `Source = 'service-probe'`). Alerting is the dead man's
switch you already have — a signal on the `up = 1` heartbeat plus a `silence` rule, so one
alert covers the service dying, the probe dying and the host dying.

```bash
python3 service-probe.py --dry-run        # see what it would send
python3 service-probe.py --setup-alerts --webhook https://hooks.slack.com/... --format slack
```

The tool is [tools/service-probe/](tools/service-probe/README.md); the design and event
schema are in [docs/service-status.md](docs/service-status.md).

---

## Query language

```
@Level = 'Error' and StatusCode >= 500
(UserId = 42 or UserId = 43) and not RequestPath like '/health%'
@Message contains 'timeout'
Has(OrderId) and @Level = 'Warning'
'connection refused'                     -- free text, full-text searched
```

Full grammar: [docs/query-language.md](docs/query-language.md).

---

## Configuration

Environment variables (or `appsettings.json` under `LogHarbor:`):

| Setting | Default | Meaning |
|---|---|---|
| `LogHarbor__DatabasePath` | `data/logharbor.db` | SQLite file location |
| `LogHarbor__MaxBatchBytes` | 5 MB | Max ingestion payload per request |
| `LogHarbor__MaxEventBytes` | 256 KB | Max size of a single event |
| `LogHarbor__IngestRateLimitPerMinute` | 1200 | Per-API-key ingestion rate limit |
| `LogHarbor__LoginRateLimitPerMinute` | 10 | Per-IP login attempt limit |
| `LogHarbor__RetentionDays` | 365 | Delete archived data older than N days |
| `LogHarbor__Archive__CompressAfterDays` | 90 | Compress events older than N days (0 = off) |
| `LogHarbor__Archive__HydrationKeepDays` | 1 | Keep an extracted archive day in the cache for N days |
| `LogHarbor__Archive__MaxDatabaseBytes` | 0 (off) | Hard ceiling on the database file; over it the oldest days are dropped whatever their age. Any positive value must be at least 64 MB |
| `LogHarbor__ArchivePath` | `archive/` next to the database | Where compressed daily segments are written |
| `LogHarbor__SeedDefaultAdmin` | `true` | Seed the admin account on an empty user table |
| `LogHarbor__AllowInsecureCookie` | `false` | Issue the session cookie without `Secure` so login works over plain HTTP (testing/LAN only; leave `false` behind an HTTPS proxy) |
| `LOGHARBOR_ADMIN_PASSWORD` | *(unset)* | Password for the seeded admin; unset means admin/admin, changed at first login |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(unset)* | When set, LogHarbor exports its own metrics (ingest rate, query latency, archive job duration, HTTP server metrics) to this OTLP endpoint; unset means self-telemetry is fully off |

Archive settings are also editable at runtime on the Settings page, which takes precedence.

Directory sign-in has no entry in this table on purpose: it is configured on the Settings page
and stored in the database, and it holds no password to keep out of a file
([docs/ldap.md](docs/ldap.md)).

---

## Backup & restore

`GET /api/admin/backup` (admin only — also linked on the Settings page) streams
one zip holding everything an instance needs:

```
logharbor-backup-YYYYMMDD-HHmmss.zip
├── logharbor.db          the database, snapshotted with VACUUM INTO
└── archive/              the compressed daily segments, when archiving has run
    └── events-YYYY-MM-DD.jsonl.br
```

Both parts matter. Once archiving has run, the database holds recent events plus
the *file names* of the archived days — the history itself lives in `archive/`.
A backup of the database alone restores an instance that lists days it can no
longer produce.

Restore — unzip into the data volume:

```bash
docker compose stop logharbor
docker run --rm -v logharbor_logharbor-data:/data -v "$PWD":/backup alpine \
  sh -c 'owner=$(stat -c "%u:%g" /data) && \
         apk add --no-cache unzip >/dev/null && \
         unzip -o /backup/logharbor-backup-YYYYMMDD-HHmmss.zip -d /data && \
         chown -R "$owner" /data'
docker compose start logharbor
```

The `chown` is not optional. LogHarbor runs as a non-root user inside the
container, and unzipping as root leaves files it cannot write — the server then
dies at startup with `SQLite Error 8: attempt to write a readonly database`.
Reading the owner off `/data` keeps the restore correct whatever uid the image
uses.

The volume name carries your compose project as a prefix (`logharbor_...` when
the project directory is `logharbor`); `docker volume ls` shows the exact name.

Running from source: stop the backend, unzip over the directory holding
`LogHarbor__DatabasePath` (default `data/`), then start again.

An older `.db`-only backup still restores — put it in place as `logharbor.db`.
Any archived day whose file is then missing is shown as **file missing** on the
Settings page instead of being offered for extraction, so the gap is visible
rather than silent.

---

## Upgrading

New code, same data volume. Schema changes are numbered SQL files applied at
startup, in order, each in its own transaction and recorded in
`schema_migrations`, so upgrading is a rebuild and a restart:

```bash
git pull
docker compose up -d --build
```

From source: `git pull`, then run the backend again against the same
`LogHarbor__DatabasePath`.

Take a backup first when it costs you nothing — the download link on the
Settings page, or `GET /api/admin/backup` with an admin session.

The startup log names every migration it applies and how many there were:

```
info: LogHarbor.Migrations[0]
      Applied migration 014_ingest_rejections.sql
info: LogHarbor.Migrations[0]
      Schema upgraded: 7 migration(s) applied
```

An ordinary restart prints none of this. That is the difference to check for
after a rebuild — silence means the schema was already current, not that the
migration step was skipped. A migration that fails takes the whole startup with
it (the transaction rolls back and the process exits), so a server that answers
`/healthz` has the schema the build expects.

**Rolling back.** Migrations are forward-only and tracked by file name, so an
older build started against a newer database does not try to undo anything: it
skips every migration it knows about and runs. Measured on a database seeded by
the 001–007 schema, upgraded to 014 and then handed back to the old build — it
started clean, read the hot events, the events the new build had ingested, and
the archived days. That is one measurement, not a guarantee for every future
pair of versions: a rollback across a migration that *rewrites* data would still
need the backup. Take one first if the upgrade spans a release you have not run.

---

## Docs

| File | Contents |
|---|---|
| [docs/running-in-5-minutes.md](docs/running-in-5-minutes.md) | Zero to first log line, step by step |
| [docs/architecture.md](docs/architecture.md) | System overview and components |
| [docs/data-model.md](docs/data-model.md) | Event schema and storage design |
| [docs/api.md](docs/api.md) | HTTP API endpoints |
| [docs/query-language.md](docs/query-language.md) | Filter/search syntax |
| [docs/frontend.md](docs/frontend.md) | UI structure and pages |
| [docs/ingestion-app.md](docs/ingestion-app.md) | Sending logs from your app |
| [docs/ingestion-otlp.md](docs/ingestion-otlp.md) | Sending logs with OpenTelemetry (OTLP) |
| [docs/ingestion-docker.md](docs/ingestion-docker.md) | Collecting Docker logs via Vector |
| [docs/archiving.md](docs/archiving.md) | Tiered storage: compression, hydration, retention |
| [docs/service-status.md](docs/service-status.md) | Up/down for systemd units and Docker containers |
| [docs/ldap.md](docs/ldap.md) | Directory sign-in: the fields, the two groups, reading the test button |
