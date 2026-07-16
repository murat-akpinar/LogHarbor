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

Live run against the test server (2026-07-16, LogHarbor in Docker), operation
`Report query {Query} took {Elapsed} ms`, ramp 60 → 600 ms at +40 ms/tick, 8 events/tick,
cron ticking once a minute. Both detectors fired.

- **slow-operations first flagged:** tick 3, ~4 min in, ×2.1 (baseline 70 ms → now 146 ms,
  n=24). Detection needs the ramp to clear the ×2 factor *and* the sample gate, so it lands
  one tick after the duration itself doubles.
- **Alert webhook first fired:** ~6 min in (events crossed 200 ms at tick 4; two ticks filled
  the count). Payload:
  `{"rule":"anomaly-sim alert","signal":"anomaly-sim slow","filter":"Elapsed > 200","count":16,"threshold":10,"windowMinutes":5,...}`
- **Ramp curve observed** (`check` once a minute, `minSamples=10&floorMs=40`, window from the
  anomaly start):

  | after tick | current p95 | × slower |
  |---|---|---|
  | 0–2 | ≤140 ms | not yet (<×2) |
  | 3 | 146 ms | ×2.1 ← first flag |
  | 6 | 267 ms | ×3.8 |
  | 9 | 383 ms | ×5.5 |
  | 12 | 502 ms | ×7.2 |
  | 14 | 574 ms | ×8.2 (ramp at the 600 ms cap) |

  The baseline p95 stayed pinned at 70 ms throughout — the backfilled baseline does not drift
  as the live window degrades, which is what makes the ratio climb cleanly.
- **Caveat on reading these numbers:** they come from `check`, which passes an explicit
  `from = anomaly start` and a loosened gate. The same regression is **invisible** on the
  Analysis page's default range — see the first improvement item below.

## LogHarbor Improvement Opportunities

_Findings surfaced by running this harness against the test server._

- **The Analysis page's default 24 h range can never flag an operation younger than 24 h —
  including a live, ×4 regression.** The selected `from` is not the start of the analysed
  window; it is the **split** between "usual" and "now": `SlowOperationsAsync` calls the store
  with `baselineFromUtc = 2000-01-01` and `splitUtc = from` (`StatsEndpoints.cs:97`), so the
  baseline is *everything older than the range you picked* and the current window is the range
  itself. Picking a **wider** range therefore shrinks the baseline instead of adding data.

  Measured against a live ramp (60 → 600 ms, regression ongoing):

  | Range | Params | Result |
  |---|---|---|
  | last 10 min | UI defaults | `×3.8` (70 → 267 ms) |
  | last 30 min | UI defaults (`minSamples=20`) | `[]` — baseline has <20 samples |
  | last 30 min | `minSamples=5&floorMs=40` | `×4.3` (70 → 300 ms) — data was there |
  | last 24 h (page default) | `minSamples=1&floorMs=1` | `[]` — baseline is *empty*, no gate can help |

  The 24 h row is the important one: the operation only has history from today, so the
  baseline window `[2000-01-01, now-24h)` holds nothing and the row is unreachable at any
  threshold. Any newly deployed service or endpoint is invisible here, and an empty result
  renders identically to "nothing regressed", so the page reads as "no slowdown" while a
  4× regression is in flight. Worth: a trailing-baseline model (baseline = the window before
  the current one, e.g. previous 24 h vs. last 1 h) rather than "everything older than
  `from`", and a UI that separates "no baseline for this operation yet" from "nothing
  regressed".
- **Webhook targets on `127.0.0.1` silently fail under Docker.** LogHarbor runs in the
  container, so `127.0.0.1:<port>` is the *container's* loopback, not the host's service —
  the POST fails with connection refused and only shows up in the rule's `lastError`. The
  alert form (and `docs/ingestion-docker.md`) could warn, or validate loopback targets when
  running containerized.
- **Alerts are count-only; there is no push alert on latency.** The p95 regression detector
  is pull-only (Analysis page). To alarm on "slow", you have to approximate it with
  `Elapsed > N` plus a count threshold, which needs a hand-picked absolute N — exactly the
  threshold that slow-operations otherwise frees you from.
- **Alert retry: the cooldown equals `windowMinutes`.** If the first webhook delivery fails
  (target not up yet), there is no retry until the next window — the first alert is simply
  lost. Observed with a listener that started late.
- **`seed-demo` emits `DurationMs`, but `slow-operations` defaults to `Elapsed`.** A source
  following the seed-demo convention isn't picked up without a `property=` override; the two
  in-repo conventions should agree.
