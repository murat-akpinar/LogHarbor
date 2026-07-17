# Running in 5 Minutes

Zero to "my own log line is on the screen", one step at a time, no branching.
Every command is copy-paste ready.

## 1. Start the server (1 min)

```bash
git clone https://github.com/murat-akpinar/LogHarbor.git
cd LogHarbor
docker build -t logharbor .
docker run -d --name logharbor -p 5000:5000 -v logharbor-data:/data \
  -e LogHarbor__AllowInsecureCookie=true logharbor
```

`AllowInsecureCookie` lets the login cookie work over plain `http://` — right
for trying it out on localhost or a LAN box. Remove it when LogHarbor sits
behind an HTTPS reverse proxy (README "Testing over plain HTTP").

## 2. Sign in (30 s)

Open <http://localhost:5000> and sign in with **admin / admin**. LogHarbor
immediately forces a password change and refuses everything else until you set
one — pick a new password and you land on the Events page.

## 3. First API key (30 s)

The Events page is empty, so it shows **"Send your first log"** instead of an
empty table. Type a key title (or leave it) and click **Create key** right
there. The token is shown **once** — it is already filled into the snippets
below it.

## 4. First event (1 min)

Pick the **curl** tab in the same panel and run the copied command — it is this,
with your key and address already in place:

```bash
curl -X POST "http://localhost:5000/api/events/raw" \
  -H "X-LogHarbor-ApiKey: <your key>" \
  -H "Content-Type: application/vnd.serilog.clef" \
  --data-binary '{"@t":"2026-07-18T12:00:00Z","@mt":"Hello from {Source}","Source":"curl"}'
```

Expect `201`. The panel polls for you — within five seconds it replaces itself
with the event list and your line is on screen. Click the row to see its
properties; `Source = "curl"` is already a filterable field.

Real apps don't curl: point your existing Serilog/NLog/winston Seq sink or any
OTLP exporter at the same address —
[ingestion-app.md](ingestion-app.md) / [ingestion-otlp.md](ingestion-otlp.md).

## 5. First search and dashboard (2 min)

- In the search bar type `Source = 'curl'` and press Enter — filters use a
  Seq-like language ([query-language.md](query-language.md)).
- Send the curl a few more times, switch **Live tail** on, send again — events
  stream in without refresh.
- Open **Dashboard**: the histogram, level cards and heatmap are already
  counting your events. Clicking a histogram bar jumps back to Events filtered
  to that time slice.

That's the loop: ingest → search → watch → chart. From here:

| Next | Where |
|---|---|
| Send logs from your app (Serilog, NLog, Python, Node) | [ingestion-app.md](ingestion-app.md) |
| Send logs via OpenTelemetry (any language, Collector) | [ingestion-otlp.md](ingestion-otlp.md) |
| Collect logs from existing Docker containers | [ingestion-docker.md](ingestion-docker.md) |
| Saved filters (Signals) and webhook Alerts (Slack/Discord) | [api.md](api.md) ALERTS |
| Backups | README "Backup & restore" |
