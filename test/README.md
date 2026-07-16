# LogHarbor Test Tooling

Three tools that put real events into a running LogHarbor. They answer different questions, so
pick by what you want to find out — none of them is a replacement for the unit suites
(`dotnet test backend`, `npm run test` in `frontend/`).

| Tool | Question it answers | Shape |
|---|---|---|
| [`scripts/seed-demo.ps1`](scripts/seed-demo.ps1) | "What does a populated UI look like, right now?" | one-shot backfill: ~3000 events spread over the last 7 days |
| [`traffic-sim/`](traffic-sim/README.md) | "What does LogHarbor feel like against a real stream?" | continuous daemon: ~10k events/day, four services, day/night rhythm, runs for days |
| [`anomaly-test/`](anomaly-test/README.md) | "Does LogHarbor actually notice a slowdown?" | ramped `Elapsed` (60 → 600 ms) until slow-operations and an alert webhook fire |

## Which one do I want?

- **Just want data on screen for a demo or a screenshot?** `seed-demo.ps1`. It finishes in seconds
  and backfills history, so the dashboard, heatmap and Analysis pages all have shape immediately.
- **Want to live with the product for a few days?** `traffic-sim`. It streams in real time, so live
  tail trickles like a real service and the heatmap grows a genuine daytime band and weekend gap.
- **Want to test detection, not decoration?** `anomaly-test`. It proves the two ways LogHarbor
  surfaces a regression: the Analysis page's "Slower than usual" (pull) and an alert webhook (push).
  Its README also records what the live run found, including LogHarbor bugs it surfaced.

`traffic-sim` and `anomaly-test` can run at the same time against the same server — they use
different `Source` tags and different message templates, so their events never merge into one group.

## Configuration and secrets

Each tool reads a git-ignored `.env` next to it, created from the committed `.env.example`:

```bash
cd test/traffic-sim     # or test/anomaly-test
cp .env.example .env    # then fill in the CHANGE_ME values
```

`.env` is ignored globally (`.gitignore`), and every `.env.example` carries `CHANGE_ME` instead of
a real value. **Never commit a real API key or admin password.** `seed-demo.ps1` takes its
password as a parameter instead of a file.

Ingestion only needs an API key. `anomaly-test` additionally needs admin credentials, because
creating signals/alerts and reading `/api/stats/*` sit behind the auth gate; `traffic-sim` does not.

## Cleaning up

**There is no delete-events API.** Anything these tools send stays until retention (default 365
days). Every event is tagged so you can filter it out:

```
Source <> 'traffic-sim'      -- exclude the traffic simulator
Source <> 'anomaly-sim'      -- exclude the anomaly harness
```

Bear that in mind before pointing any of these at a server whose data you care about. Each tool's
README documents its own stop/cleanup steps.
