# LogHarbor Traffic Simulator

Streams realistic, multi-service log traffic into a running LogHarbor **until you stop it**, so
that after a few days you can see what the product feels like against a real stream: the
day×hour heatmap, dashboard curves, live tail, Analysis, signals.

This is about **feel, not load** — ~10,000 events/day by default. For a one-shot backfill use
`test/scripts/seed-demo.ps1`; to prove slowdown detection use `test/anomaly-test/`.

## What it sends

Four services, each with its own rhythm, all tagged `Source="traffic-sim"` and `Service=<name>`:

| Service | Share | Rhythm | Templates |
|---|---|---|---|
| `api` | 55% | diurnal, peaks ~10-15 UTC | `Handled {Method} {Path} in {Elapsed} ms` · `Slow request {Path} took {Elapsed} ms` (Warning) · `Request failed {Path}` (Error, with exception + nested `Cart`) · `Cache {Outcome} for {Path}` (Debug) |
| `worker` | 25% | flat 24/7, batch surge at 02:00 UTC | `Processed job {JobType} ({JobId}) in {Elapsed} ms` · `Job {JobId} retry {Attempt}` (Warning) · `Job {JobId} failed` (Error) |
| `db` | 12% | follows `api` | `Query {Name} took {Elapsed} ms` (Information/Warning) |
| `auth` | 8% | follows `api` | `User {UserId} signed in from {Ip}` · `Failed login for {UserId}` (Warning) · `Account {UserId} locked` (Error) |

`api` sleeps at night while `worker` keeps going, and weekends scale by `WEEKEND_FACTOR`, so the
heatmap gets both a daytime band and a weekend gap. `db` carries `Elapsed`, the property
`slow-operations` defaults to, so the Analysis page's "Slower than usual" card sees real data.

Arrivals are Poisson, one event per request, so live tail trickles like a real service instead of
clumping once a minute. At the default budget that is ~2.5 events/min at night and ~11.6 at the
midday peak.

## Requirements

`python3` (stdlib only) and systemd. A LogHarbor ingestion API key — no admin credentials needed.

## Try it without sending anything

```bash
cd test/traffic-sim
python3 traffic-sim.py --dry-run
```

Prints the 24-hour rate table and ten sample events. Use it to sanity-check the shape and the
daily total before committing to a long run. The curve is normalized against its own mean, so
`EVENTS_PER_DAY` stays the daily total however you reshape `DAY_CURVE`.

## Run it

```bash
cp .env.example .env      # then put the real ingestion key in LOGHARBOR_API_KEY
set -a && . ./.env && set +a
python3 traffic-sim.py    # Ctrl-C to stop
```

## Run it for a week (systemd)

```bash
mkdir -p /root/traffic-sim
cp traffic-sim.py .env /root/traffic-sim/
cp traffic-sim.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now traffic-sim
```

Watch it:

```bash
systemctl status traffic-sim
journalctl -u traffic-sim -f          # ingest failures show up here
```

It restarts itself on crash and survives reboot. Ingest failures back off (1s → 60s) and retry
forever, so a LogHarbor restart only leaves a short gap.

## Stop it

```bash
systemctl disable --now traffic-sim
```

## Clean up

**There is no delete-events API.** Everything sent stays until retention (default 365 days). Every
event carries `Source="traffic-sim"`, so exclude it with:

```
Source <> 'traffic-sim'
```

or find it with `Source = 'traffic-sim'`.

## Configuration

`.env` (see `.env.example`). systemd reads it directly as `EnvironmentFile`, so keep it plain
`KEY=VALUE` — no quotes, no `export`.

| Variable | Default | Meaning |
|---|---|---|
| `LOGHARBOR_URL` | — | base URL of the LogHarbor server |
| `LOGHARBOR_API_KEY` | — | ingestion key |
| `EVENTS_PER_DAY` | 10000 | weekday budget; the hourly curve is normalized so its shape never changes this total |
| `WEEKEND_FACTOR` | 0.5 | Saturday/Sunday multiplier |

Traffic mix, service shares and templates are constants at the top of `traffic-sim.py`
(`DAY_CURVE`, `WORKER_CURVE`, `SERVICES`, `LEVEL_WEIGHTS`).
