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

- **Search** with a Seq-like filter language (`@Level = 'Error' and Elapsed > 500`)
- **Live tail** over SignalR, filtered server-side
- **Signals**: saved filters you can toggle on
- **Dashboard**: level histogram, summary cards, activity heatmap
- **Analysis**: top errors grouped by message template, top exception types
- **Alerts**: webhook when a signal matches N events in a time window
- **Archive**: old events compressed to daily Brotli segments, hydrated back on demand
- **Seq wire-compatible**: existing Seq sinks ingest into LogHarbor unchanged
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

### Testing over plain HTTP (home / LAN)

In production LogHarbor runs behind an HTTPS reverse proxy, so outside development the session
cookie is issued with `Secure`. Reaching it over plain HTTP — `http://localhost:5000` or a LAN
address like `http://192.168.1.50:5000` — then breaks login: the browser drops the `Secure`
cookie, the sign-in never sticks, and you land back on the login screen instead of the
change-password step (even though **admin / admin** is correct).

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
# terminal 1 — backend on :5000 (Swagger UI at /swagger)
dotnet run --project backend/LogHarbor.Api

# terminal 2 — frontend dev server on :5173, proxies /api and /hubs to the backend
cd frontend && npm install && npm run dev
```

Tests:

```bash
dotnet test backend
cd frontend && npm run build && npm run lint
```

---

## Sending logs

Three independent routes; run any or all of them.

### From inside your app — structured properties

LogHarbor's ingestion endpoint is wire-compatible with Seq: same path, same CLEF body, and
`X-Seq-ApiKey` is accepted alongside `X-LogHarbor-ApiKey`. So **point an existing Seq sink at
LogHarbor and it works** — with its batching, retry and buffering included.

Serilog (.NET), `dotnet add package Serilog.Sinks.Seq`:

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Seq("http://localhost:5000", apiKey: Environment.GetEnvironmentVariable("LOGHARBOR_API_KEY"))
    .CreateLogger();

Log.Error(ex, "Order {OrderId} failed for {Customer}", 123, "acme");
```

`OrderId` and `Customer` become queryable fields, and every `Order {OrderId} failed` event
groups as one error on the Analysis page regardless of the id.

Same deal with `NLog.Targets.Seq` (.NET), `seqlog` (Python) and `@datalust/winston-seq`
(Node) — set the server URL and API key, nothing else. Details and per-language snippets:
[docs/ingestion-app.md](docs/ingestion-app.md).

Anything else: POST newline-delimited CLEF yourself.

```bash
curl -X POST http://localhost:5000/api/events/raw \
  -H "X-LogHarbor-ApiKey: logharbor_your_token_here" \
  -H "Content-Type: application/vnd.serilog.clef" \
  --data-binary '{"@t":"2026-07-13T10:00:00Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}'
```

### OpenTelemetry (OTLP)

Any OTel SDK or Collector can send logs directly — no Seq sink needed:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5000
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<your-key>
```

Both protobuf and JSON encodings are accepted on `/v1/logs`. See
[docs/ingestion-otlp.md](docs/ingestion-otlp.md) for the Collector config and
the full field mapping.

### From Docker containers — no app changes

Run one Vector container per host. It reads every container's stdout/stderr and ships it to
LogHarbor, tagged with the compose project and service name, so `App = 'shop-api'` and
`Service = 'backend'` work with no per-project configuration. Log lines arrive as text
rather than structured fields — the trade for touching nothing.

Setup: [docs/ingestion-docker.md](docs/ingestion-docker.md).

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
| `LogHarbor__SeedDefaultAdmin` | `true` | Seed the admin account on an empty user table |
| `LogHarbor__AllowInsecureCookie` | `false` | Issue the session cookie without `Secure` so login works over plain HTTP (testing/LAN only; leave `false` behind an HTTPS proxy) |
| `LOGHARBOR_ADMIN_PASSWORD` | *(unset)* | Password for the seeded admin; unset means admin/admin, changed at first login |

Archive settings are also editable at runtime on the Settings page, which takes precedence.

---

## Docs

| File | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System overview and components |
| [docs/data-model.md](docs/data-model.md) | Event schema and storage design |
| [docs/api.md](docs/api.md) | HTTP API endpoints |
| [docs/query-language.md](docs/query-language.md) | Filter/search syntax |
| [docs/frontend.md](docs/frontend.md) | UI structure and pages |
| [docs/ingestion-app.md](docs/ingestion-app.md) | Sending logs from your app |
| [docs/ingestion-docker.md](docs/ingestion-docker.md) | Collecting Docker logs via Vector |
| [docs/archiving.md](docs/archiving.md) | Tiered storage: compression, hydration, retention |
