# Traffic Simulator — Design

**Date:** 2026-07-16
**Status:** approved, ready for planning

## Goal

A long-running generator that streams realistic, multi-service log traffic into LogHarbor until
we stop it, so that after a week we can see what the product actually feels like against a real
diurnal stream: dashboard curves, the day×hour heatmap, live tail, Analysis, signals.

This is about **feel, not load**. Volume stays modest (~10k events/day by default); it is not a
soak or stress test.

Sibling of `test/anomaly-test/` (which proves slow-operations and alerts) and of
`test/scripts/seed-demo.ps1` (a one-shot backfill). This one is the missing third: continuous,
real-time, open-ended.

## Constraints

- **Target:** the Linux test server (`http://192.168.1.131:5000`, LogHarbor in Docker). Needs
  `python3` (stdlib only) and systemd.
- **No delete-events API.** Everything sent is permanent until retention (default 365 days).
  Every event therefore carries `Source="traffic-sim"` so it can be filtered
  (`Source = 'traffic-sim'`), and the README says so plainly.
- **Target instance:** the existing one on :5000, alongside the anomaly-sim events already there.
- **Secrets:** the ingestion key lives only in a git-ignored `.env`; the committed
  `.env.example` carries `CHANGE_ME`.
- Ingestion is key-only (`POST /api/events/raw`), so the simulator never needs admin creds.

## Layout

`test/traffic-sim/`, everything committed so anyone can reproduce the run:

| File | Purpose |
|---|---|
| `traffic-sim.py` | the generator daemon (python3, stdlib only) |
| `traffic-sim.service` | systemd unit template |
| `.env.example` | config contract, `CHANGE_ME` for the key |
| `README.md` | install, run, watch, stop, clean up |

Python rather than bash: weighted sampling, a diurnal rate curve, Poisson sleeps and JSON
construction are painful in bash — `webhook-listener.py` set the stdlib-only precedent.

## The stream

Four services, each with its own rhythm and templates. Every event carries `Source`,
`Service`, and a `@mt` template; Error/Fatal carry `@x`.

| Service | Rhythm | Templates |
|---|---|---|
| `api` | diurnal, peak ~10-17 UTC | `Handled {Method} {Path} in {Elapsed} ms` (Info) · `Slow request {Path} took {Elapsed} ms` (Warning) · `Request failed {Path}` (Error, `@x`) |
| `worker` | flat 24/7 + a batch surge ~02:00 UTC | `Processed job {JobType} ({JobId}) in {Elapsed} ms` (Info) · `Job {JobId} retry {Attempt}` (Warning) · `Job {JobId} failed` (Error, `@x`) |
| `auth` | follows `api`, lower volume | `User {UserId} signed in from {Ip}` (Info) · `Failed login for {UserId}` (Warning) · `Account {UserId} locked` (Error, rare) |
| `db` | follows `api` | `Query {Name} took {Elapsed} ms` (Info/Warning) |

The layering is the point: `api` sleeps at night while `worker` keeps going, and the whole
stream drops to ~0.5× at weekends, so the day×hour heatmap shows both a daytime band and a
weekend gap. `db` carries `Elapsed`, which is the property `slow-operations` defaults to, so the
Analysis card gets real content.

Level mix follows `seed-demo.ps1` (mostly Information, some Warning, few Error, rare Fatal),
tuned per service. Error/Fatal events carry realistic exception text; a fraction of events carry
a nested object (a `Cart`-style value) to exercise EventDetail's collapsible property tree.

## Timing model

- `EVENTS_PER_DAY` (default 10000) is the budget for one **weekday**. The diurnal curve (peak ~3×,
  trough ~0.3×) is normalized so its 24-hour integral equals that budget — changing the curve's
  shape must not change the daily total. Weekends then scale the whole day by ~0.5×.
- Arrivals are **Poisson**: the loop sleeps `random.expovariate(rate)` between events, so events
  trickle at natural, irregular intervals rather than in per-minute clumps. Live tail then looks
  like a real service. At the default budget that is ~7 events/min on average, ~20 at peak, ~2 at
  night — one event per POST is fine at that rate and is the most realistic shape.
- Each event is sent with `@t` = now; no backfilling.

## Resilience

If LogHarbor is down or returns a non-201, the daemon logs to stderr and retries with capped
backoff. It never exits on ingest failure — a week-long run must survive a container restart.
systemd `Restart=always` is the backstop for anything that does kill the process.

```ini
[Service]
Type=simple
WorkingDirectory=/root/traffic-sim
EnvironmentFile=/root/traffic-sim/.env
ExecStart=/usr/bin/python3 /root/traffic-sim/traffic-sim.py
Restart=always
RestartSec=5
```

Installed as `traffic-sim.service`, so the unit is `traffic-sim`: stop with
`systemctl stop traffic-sim`, watch with `journalctl -u traffic-sim -f`.

## Verification

No Python test stack is added — this is tooling, not product code, and the repo's suites are
xUnit and Vitest.

- `--dry-run`: prints sample events and a 24-hour rate table without sending anything, so the
  event shape, level mix and diurnal curve can be checked by eye before a week-long commitment.
- Live smoke test: send a short burst, confirm `/healthz` `eventCount` rises and the events are
  visible in the UI filtered by `Source = 'traffic-sim'`.

## Out of scope

- Engineered incidents (error storms, latency spikes) — the anomaly harness covers regression
  detection; this stream is steady-state realism.
- High-volume soak / retention / archiving behaviour (archiving only starts at
  `CompressAfterDays`, default 90).
- A second LogHarbor instance for isolation; considered and dropped in favour of `Source` tagging
  on the existing server.
