# Anomaly Test Harness — simulating a latency regression against LogHarbor

**Date:** 2026-07-15
**Status:** approved for planning

## Context

The user runs a LogHarbor instance on a home test server (`http://192.168.1.131:5000`,
plain HTTP, `LogHarbor__AllowInsecureCookie=true`). They want a small, cron-driven tool
that repeatedly sends the **same** structured log event (a simulated DB query) with a
deliberately, **gradually increasing** duration, to verify that LogHarbor detects the
slowdown as an anomaly.

LogHarbor already ships two relevant detection mechanisms; the harness targets **both**:

- **slow-operations** (`GET /api/stats/slow-operations`) — adaptive, threshold-free
  latency regression on the Analysis page ("Slower than usual"). Groups events by
  `@mt` (message_template), takes the numeric `Elapsed` (ms) property, and flags a
  group when its p95 over `[from, to)` is `>= factor ×` its own baseline p95 over
  `[2000-01-01, from)`. Guardrails: `minSamples` (default 20 in **each** window),
  `floorMs` (default 50, baseline p95 must clear it), `factor` (default 2.0). All are
  query-param overridable.
- **Alerts** (`POST /api/alerts`) — count-based webhook. A signal (saved filter, e.g.
  `Elapsed > 200`) is evaluated once a minute; when it matches `>= thresholdCount`
  events within the trailing `windowMinutes`, a webhook POST fires. Cools down one full
  `windowMinutes` after firing. This measures latency **indirectly** (how many events
  crossed a fixed duration), which is the closest LogHarbor gets to a live latency alert.

Grounding facts verified in the codebase:
- Ingestion: `POST /api/events/raw`, header `X-LogHarbor-ApiKey: <token>`,
  `Content-Type: application/vnd.serilog.clef`, newline-delimited CLEF JSON. `@t` is
  client-supplied, so baseline events can be **backfilled** with past timestamps.
  Rate limit default 1200/min per key; our batches are small.
- Filter language: `Elapsed > 200` is valid numeric comparison; `@mt` grouping is on
  the raw `@MessageTemplate`, so a fixed `@mt` = one operation group regardless of
  property values.
- Signals/alerts are mutating endpoints → require an **admin session cookie**
  (ingestion API key is not enough). No CSRF/antiforgery token, so `curl` with a cookie
  jar works. Cookie `logharbor_session` is issued without `Secure` over plain HTTP
  because `AllowInsecureCookie=true`.

## Goal

A reusable test harness under `test/anomaly-test/` (sibling to the existing
`test/scripts/seed-demo.ps1`) that:
1. Seeds a normal-latency **baseline** instantly (backfilled past timestamps).
2. Runs a cron-driven **live ramp** that gradually raises the duration.
3. Trips **both** detectors: the `slow-operations` regression and an `Elapsed > N`
   alert webhook.
4. Captures the observed behaviour — timings, friction, and **LogHarbor improvement
   opportunities** — into the README.

## Approach: hybrid baseline (chosen)

- **Backfill baseline** (once, `seed-baseline`): send ~30 events with `@t` spread over
  the last ~45 min at ~60 ms ± jitter. Records `anomaly_start = now` in a state file.
  Fills the baseline window `[2000-01-01, anomaly_start)` immediately — no waiting.
- **Live ramp** (cron, `tick`): every minute send `BATCH` (default 8) events at
  `@t = now`, at the current ramp level. Ramp climbs each tick
  (`ramp_ms = BASELINE_MS + tick × RAMP_STEP_MS`, capped at `RAMP_MAX_MS`), e.g.
  60 → 100 → 140 → … → 600 ms. The state file carries `tick` because cron is stateless.

Why hybrid: the baseline is ready at once (no ~10 min warm-up), yet the ramp is a real
wall-clock climb you can watch get flagged, and the live current-time events are what a
count-based alert needs to fire.

## Expected detection timeline (defaults)

- Baseline p95 ≈ 65 ms (backfill), clears `floorMs=50`.
- `slow-operations`: current-window p95 crosses `2 × 65 ≈ 130 ms` around tick 4–5
  (~4–5 min); `×slower` then climbs as the ramp rises toward 600 ms (~9×). Current
  window reaches `minSamples=20` in ~3 ticks (8/tick).
- Alert (`Elapsed > 200`, threshold 10, window 5 min): ramp passes 200 ms ≈ tick 5;
  ~2 more ticks accumulate ≥10 slow events in the trailing window → webhook fires
  ≈ tick 7 (~7–8 min). Cooldown 5 min, then may refire.

Full anomaly (~600 ms, ~9× baseline) is reached ≈ tick 14 (~15 min), so **both**
detectors fire well before the ramp tops out.

## Components (each single-purpose)

1. **`anomaly-sim.sh`** — `bash` + `curl`, subcommands:
   - `seed-baseline` — backfill baseline, write `anomaly_start` + `tick=0` to state.
   - `tick` — the cron entry point: send `BATCH` events at the current ramp level,
     `@t = now`, increment `tick`.
   - `setup-alert` — admin login (cookie jar) → `POST /api/signals` (`Elapsed > 200`)
     → `POST /api/alerts` (threshold 10, window 5, `webhookUrl=http://127.0.0.1:9099/`,
     enabled). Idempotent-ish: skip/replace if a signal/alert with the same title exists.
   - `check` — `GET /api/stats/slow-operations?from=<anomaly_start>&to=now&minSamples=10`
     (lower `minSamples` for faster feedback), print the operation + `×slower`, or
     "not yet"; also tail the webhook log.
   - `reset` — clear state; optionally delete the created signal/alert.
2. **`webhook-listener.py`** — ~15-line `http.server`, binds `127.0.0.1:9099`, appends
   each webhook POST body with a UTC timestamp to `webhook.log`. Not exposed to the LAN.
3. **`.env.example`** — every knob with a `CHANGE_ME` placeholder for secrets.
4. **`README.md`** — setup, crontab line, run order, and the observations section.

## Event shape (CLEF)

```json
{"@t":"2026-07-15T12:00:00Z","@l":"Information","@mt":"DB query {Query} took {Elapsed} ms","Query":"SELECT * FROM orders WHERE status='open'","Elapsed":184,"Source":"anomaly-sim"}
```

- `@mt` is **constant** → single operation group.
- `Elapsed` (ms) is the ramped number; each event jitters ± `JITTER_MS` (~10) around
  the tick's ramp level.
- `Source="anomaly-sim"` tags every synthetic event so it can be filtered/excluded
  later (`Source = 'anomaly-sim'`). There is no delete-events API; test events persist
  until retention, so a tag is the clean-up handle.

## Configuration & secrets

`.env` (git-ignored), copied from `.env.example`:

| Var | Example / default | Purpose |
|---|---|---|
| `LOGHARBOR_URL` | `http://192.168.1.131:5000` | base URL |
| `LOGHARBOR_API_KEY` | `CHANGE_ME` | ingestion key (the `test1` key goes here for the real run) |
| `LOGHARBOR_ADMIN_USER` / `LOGHARBOR_ADMIN_PASS` | `CHANGE_ME` | admin login for `setup-alert` |
| `OP_TEMPLATE` | `DB query {Query} took {Elapsed} ms` | fixed `@mt` |
| `OP_QUERY` | `SELECT * FROM orders WHERE status='open'` | fixed `Query` property |
| `BASELINE_MS` / `RAMP_STEP_MS` / `RAMP_MAX_MS` / `JITTER_MS` | 60 / 40 / 600 / 10 | ramp shape |
| `BATCH` | 8 | events per tick |
| `ALERT_THRESHOLD_MS` / `ALERT_COUNT` / `ALERT_WINDOW_MIN` | 200 / 10 / 5 | alert rule |
| `WEBHOOK_PORT` | 9099 | listener port (webhookUrl `http://127.0.0.1:<port>/`) |
| `STATE_FILE` | `~/.logharbor-anomaly-state` | ramp counter + anomaly_start |

**Secrets never enter the repo.** Committed files carry `CHANGE_ME`; the real `test1`
key and admin password live only in `.env` on the test server for the actual run.

## Workflow (build → run → observe → document)

1. Build the scripts + `.env.example` + README skeleton locally.
2. Point `.env` at `http://192.168.1.131:5000` with the real `test1` key + admin creds
   and run against the live instance: `seed-baseline`, start `webhook-listener.py`,
   `setup-alert`, add the crontab `tick` line, then `check` periodically.
3. **Record observations** while it runs: when each detector first fired, the `×slower`
   progression, any friction (having to pick `from/to` manually, `minSamples` too high
   for low volume, no direct p95 alert, etc.), and anything that looks like a bug.
4. **Populate the README** "Test Results & Observations" + "LogHarbor Improvement
   Opportunities" sections from those notes.

## README contents

- **What it is** and the two detectors it exercises.
- **Prerequisites**: `bash`, `curl`, `python3`; a LogHarbor API key; admin creds.
- **Setup**: copy `.env.example` → `.env`, fill `CHANGE_ME` (note the `test1` key line),
  start the webhook listener, run `setup-alert`.
- **Run**: crontab line `* * * * * /path/to/anomaly-sim.sh tick`; how to watch with
  `check` and in the Analysis UI.
- **Clean up**: `reset`; filtering test events with `Source = 'anomaly-sim'`.
- **Test Results & Observations** — filled after the live run: detector fire times,
  `×slower` curve, screenshots optional.
- **LogHarbor Improvement Opportunities** — bulleted findings surfaced by the test.

## Files

- **New**
  - `test/anomaly-test/anomaly-sim.sh`
  - `test/anomaly-test/webhook-listener.py`
  - `test/anomaly-test/.env.example`
  - `test/anomaly-test/README.md`
- **Modify**
  - `.gitignore` — ignore `test/anomaly-test/.env`, `webhook.log`, and the state file
    if it lands in-tree.

## Sibling context (existing `test/scripts/seed-demo.ps1`)

- The existing seed script is PowerShell for local Windows dev against `localhost:5000`;
  this harness is `bash` because it runs from **cron on the Linux test server**.
- seed-demo emits duration as **`DurationMs`**, but `slow-operations` defaults to
  **`Elapsed`**. The harness uses `Elapsed` so it triggers with no property override.
  That default mismatch (demo data vs. the feature's default property) is itself a
  candidate finding for the README's improvement section.
- seed-demo works around a **Secure** session cookie being un-replayable over plain
  HTTP (localhost dev default). On the test server `AllowInsecureCookie=true` makes the
  cookie non-Secure, so `curl -c/-b` replays it over HTTP without that workaround.

## Non-goals

- No changes to the LogHarbor product code (this is an external harness). Findings that
  call for product changes are captured in the README, not implemented here.
- No real database is queried; durations are synthetic and script-controlled.
- No teardown of already-ingested test events beyond tagging them (`Source`) — LogHarbor
  has no delete-events API by design.

## Security

- Secrets from env only; `CHANGE_ME` placeholders committed, real values git-ignored
  (rules.md SECURITY). The `test1` key the user created is used only for the local run.
- Webhook listener binds `127.0.0.1`, not the LAN interface.
- The harness is a load/anomaly **simulator** against the user's own authorized test
  server; batches stay well under the ingestion rate limit.

## Testing & verification

- `anomaly-sim.sh` sanity: `bash -n` clean; `seed-baseline` returns 201s; `check`
  parses the JSON and prints a verdict.
- End-to-end on `192.168.1.131:5000`: after ~8–10 min, `slow-operations` lists the
  `DB query {Query} took {Elapsed} ms` group with `×slower ≥ 2`, the Analysis UI shows
  it under "Slower than usual", and `webhook.log` has at least one alert POST whose body
  references the signal. Record the actual timings in the README.
