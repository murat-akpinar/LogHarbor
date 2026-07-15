# LogHarbor Anomaly Test Harness

Sends a fixed, simulated DB-query log event to LogHarbor with a **gradually rising**
`Elapsed` duration, to verify LogHarbor flags the slowdown two ways:

1. **slow-operations** — the Analysis page's "Slower than usual" (adaptive, threshold-free
   p95 regression versus the operation's own baseline).
2. **Alerts** — a webhook that fires when `Elapsed > <threshold>` matches enough events in
   a trailing window.

Sibling of `test/scripts/seed-demo.ps1`, but runs from **cron on the Linux test server**
(bash + curl + python3).

## How it works

- `seed-baseline` backfills ~30 events with **past** `@t` timestamps at ~60 ms — an instant
  "normal" baseline — and records the anomaly-window start.
- `tick` (cron, once a minute) sends a batch at the current ramp level with `@t = now`; the
  level climbs each tick (60 → 600 ms).
- slow-operations compares the live window's p95 to the backfilled baseline p95; once it is
  ≥ 2× it appears in "Slower than usual".
- The `Elapsed > 200` signal + alert fires a webhook once enough live events cross 200 ms.

Every event carries `Source="anomaly-sim"`, so you can find/exclude them later
(`Source = 'anomaly-sim'`). There is no delete-events API.

## Requirements

`bash`, `curl`, `python3`. A LogHarbor ingestion API key. For `setup-alert` and `check`,
LogHarbor **admin** credentials (stats GET + signal/alert creation are behind the auth gate).

## Setup

```bash
cd test/anomaly-test
cp .env.example .env
# edit .env: real "test1" key in LOGHARBOR_API_KEY, admin password in LOGHARBOR_ADMIN_PASS.
python3 webhook-listener.py &        # receives alert webhooks -> webhook.log
./anomaly-sim.sh seed-baseline       # instant normal baseline
./anomaly-sim.sh setup-alert         # create the Elapsed>200 signal + webhook alert
```

Install the cron ramp (once a minute):

```cron
* * * * * cd /root/anomaly-test && ./anomaly-sim.sh tick >> tick.log 2>&1
```

Watch it:

```bash
./anomaly-sim.sh check       # prints DETECTED ... xN once slow-operations flags it
tail -f webhook.log          # alert POST bodies land here
```

Also open the Analysis page in the UI → "Slower than usual".

## Clean up

```bash
./anomaly-sim.sh reset       # clears ramp state (ingested events remain)
kill %1                      # stop the webhook listener
```

## Configuration

See `.env.example`: ramp shape (`BASELINE_MS`, `RAMP_STEP_MS`, `RAMP_MAX_MS`, `BATCH`),
alert rule (`ALERT_THRESHOLD_MS`, `ALERT_COUNT`, `ALERT_WINDOW_MIN`), fixed operation
(`OP_TEMPLATE`, `OP_QUERY`).

## Test Results & Observations

_Filled after the live run against the test server (Task 5)._

- **slow-operations first flagged:** tick __, ~__ min in, ×__ (baseline __ ms → now __ ms).
- **Alert webhook first fired:** ~__ min in; payload excerpt: __.
- **Ramp curve observed:** __.

## LogHarbor Improvement Opportunities

_Findings surfaced by this test (filled during Task 5). Candidates to confirm/expand:_

- The seed-demo convention emits `DurationMs`, but `slow-operations` defaults to `Elapsed`;
  a source that follows seed-demo isn't picked up without a `property=` override.
- slow-operations is pull-only (Analysis page); there's no push alert on latency p95, so
  "slow" is approximated with `Elapsed > N` + a count-based alert.
- `from`/`to` must be chosen by hand to split baseline from current window.
- (add empirical findings from the run)
