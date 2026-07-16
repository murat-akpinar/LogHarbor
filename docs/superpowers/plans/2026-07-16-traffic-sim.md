# Traffic Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A systemd-run Python daemon that streams realistic, multi-service log traffic into LogHarbor at Poisson intervals shaped by a diurnal curve, until we stop it, so a week of it shows what the product feels like against a real stream.

**Architecture:** One `traffic-sim.py` reads config from environment variables (systemd `EnvironmentFile`, a git-ignored `.env`). Four services each own a traffic share, an hourly shape curve, and per-level templates. The loop computes the current per-service rate, sleeps an exponential interval, picks a service weighted by rate, builds one CLEF event, and POSTs it. `--dry-run` prints the rate table and sample events without sending. A committed systemd unit runs it with `Restart=always`.

**Tech Stack:** python3 (stdlib only: `json`, `os`, `random`, `sys`, `time`, `urllib`, `datetime`), systemd, LogHarbor ingestion API.

## Global Constraints

- **Target runtime:** Linux test server (`http://192.168.1.131:5000`), python3 3.12, systemd 255. Installed to `/root/traffic-sim/`; the repo copy lives at `test/traffic-sim/`.
- **Stdlib only.** No pip installs, no virtualenv — matches `webhook-listener.py`.
- **Secrets:** the committed `.env.example` carries `CHANGE_ME`; the real ingestion key lives only in the git-ignored `.env`. `.env` is already ignored globally (`.gitignore:14`) — no new ignore rule is needed.
- **Every event carries `Source="traffic-sim"` and `Service=<name>`.** There is no delete-events API; this tag is the only cleanup handle (`Source = 'traffic-sim'`).
- **Feel, not load:** `EVENTS_PER_DAY` defaults to 10000 (a weekday budget).
- **Normalization rule:** each curve is divided by its own mean, so editing a curve's shape must never change the daily total.
- **Ingestion is key-only:** `POST /api/events/raw` with `X-LogHarbor-ApiKey` and `Content-Type: application/vnd.serilog.clef`, expects **201**. No admin credentials anywhere in this tool.
- **Language:** all code, comments and docs in English (`rules.md`).

---

### Task 1: Config contract, traffic shape, and `--dry-run`

**Files:**
- Create: `test/traffic-sim/.env.example`
- Create: `test/traffic-sim/traffic-sim.py`

**Interfaces:**
- Produces the `.env` contract every later task reads: `LOGHARBOR_URL`, `LOGHARBOR_API_KEY`, `EVENTS_PER_DAY`, `WEEKEND_FACTOR`.
- Produces the functions Task 2 consumes: `iso(when: datetime) -> str`, `service_rate(service: str, when: datetime) -> float` (events/second), `pick_level(service: str) -> str`, `build_event(service: str, level: str, timestamp: str) -> dict`, and the module constants `URL`, `API_KEY`, `SERVICES`.

- [ ] **Step 1: Create `test/traffic-sim/.env.example`**

```bash
# Copy to .env (git-ignored) and fill LOGHARBOR_API_KEY. systemd reads this file directly
# (EnvironmentFile), so it must stay plain KEY=VALUE with no quotes and no `export`.
LOGHARBOR_URL=http://192.168.1.131:5000

# Ingestion API key. Repo keeps CHANGE_ME; the real key goes in .env only.
LOGHARBOR_API_KEY=CHANGE_ME

# Weekday budget. The hourly curve is normalized against its own mean, so this is the
# daily total regardless of the curve's shape. Weekends scale by WEEKEND_FACTOR.
EVENTS_PER_DAY=10000
WEEKEND_FACTOR=0.5
```

- [ ] **Step 2: Create `test/traffic-sim/traffic-sim.py` with the shape half**

This is the whole file for Task 1; Task 2 appends the sending half.

```python
#!/usr/bin/env python3
"""LogHarbor traffic simulator: streams realistic multi-service log traffic until stopped.

One CLEF event per POST at Poisson-distributed intervals, shaped by a diurnal curve, so live
tail trickles like a real deployment instead of clumping once a minute. Every event carries
Source="traffic-sim": there is no delete-events API, so that tag is the only cleanup handle.

Usage:
  python3 traffic-sim.py            # stream until stopped (systemd / Ctrl-C)
  python3 traffic-sim.py --dry-run  # print the rate table + sample events, send nothing
"""
import json
import os
import random
import sys
from datetime import datetime, timezone

URL = os.environ.get("LOGHARBOR_URL", "http://127.0.0.1:5000")
API_KEY = os.environ.get("LOGHARBOR_API_KEY", "")
EVENTS_PER_DAY = float(os.environ.get("EVENTS_PER_DAY", "10000"))
WEEKEND_FACTOR = float(os.environ.get("WEEKEND_FACTOR", "0.5"))

# Relative traffic per UTC hour. Each curve is divided by its own mean at use, so editing a
# shape never changes the daily total.
DAY_CURVE = [0.30, 0.25, 0.25, 0.30, 0.40, 0.60, 1.00, 1.60, 2.20, 2.80, 3.00, 3.00,
             2.70, 2.90, 3.00, 2.90, 2.60, 2.10, 1.60, 1.20, 0.90, 0.70, 0.50, 0.35]
# the worker never sleeps; it just runs its batch at 02:00
WORKER_CURVE = [1.0, 1.0, 4.0, 2.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]

SERVICES = {
    "api": {"share": 0.55, "curve": DAY_CURVE},
    "worker": {"share": 0.25, "curve": WORKER_CURVE},
    "db": {"share": 0.12, "curve": DAY_CURVE},
    "auth": {"share": 0.08, "curve": DAY_CURVE},
}

LEVEL_WEIGHTS = {
    "api": {"Information": 70, "Debug": 12, "Warning": 12, "Error": 5, "Fatal": 1},
    "worker": {"Information": 75, "Debug": 10, "Warning": 10, "Error": 5},
    "db": {"Information": 85, "Warning": 15},
    "auth": {"Information": 80, "Warning": 15, "Error": 5},
}

PATHS = ["/api/orders", "/api/orders/{id}", "/api/users", "/healthz", "/api/reports/daily"]
METHODS = ["GET", "POST", "PUT", "DELETE"]
JOB_TYPES = ["invoice-export", "email-digest", "image-resize", "nightly-rollup"]
QUERIES = ["orders_by_status", "user_by_email", "daily_revenue", "cart_items"]
EXCEPTIONS = [
    "System.InvalidOperationException: Order is already shipped\n   at Api.Orders.Ship()",
    "System.TimeoutException: The operation timed out\n   at Api.Db.Query()",
    "Npgsql.PostgresException: 23505: duplicate key value\n   at Api.Db.Insert()",
]


def iso(when):
    """CLEF @t: UTC ISO-8601 with milliseconds."""
    return when.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def service_rate(service, when):
    """Events per second for one service at `when` (UTC)."""
    spec = SERVICES[service]
    curve = spec["curve"]
    shape = curve[when.hour] / (sum(curve) / len(curve))
    weekend = WEEKEND_FACTOR if when.weekday() >= 5 else 1.0
    return EVENTS_PER_DAY * spec["share"] / 86400.0 * shape * weekend


def pick_level(service):
    weights = LEVEL_WEIGHTS[service]
    return random.choices(list(weights), weights=list(weights.values()))[0]


def _user():
    return f"user-{random.randrange(50)}"


def _ip():
    return f"10.0.{random.randrange(256)}.{random.randrange(256)}"


def build_event(service, level, timestamp):
    """One CLEF event as a dict. Template (@mt) is fixed per (service, level) so groups form."""
    event = {"@t": timestamp, "@l": level, "Source": "traffic-sim", "Service": service}
    if service == "api":
        if level in ("Error", "Fatal"):
            event["@mt"] = "Request failed {Path}"
            event["Path"] = random.choice(PATHS)
            event["@x"] = random.choice(EXCEPTIONS)
            event["UserId"] = _user()
            # nested value exercises EventDetail's collapsible property tree
            event["Cart"] = {"Total": round(random.uniform(5, 500), 2), "Items": ["sku-1", "sku-7"]}
        elif level == "Warning":
            event["@mt"] = "Slow request {Path} took {Elapsed} ms"
            event["Path"] = random.choice(PATHS)
            event["Elapsed"] = random.randrange(800, 5000)
        elif level == "Debug":
            event["@mt"] = "Cache {Outcome} for {Path}"
            event["Outcome"] = random.choice(["hit", "miss"])
            event["Path"] = random.choice(PATHS)
        else:
            event["@mt"] = "Handled {Method} {Path} in {Elapsed} ms"
            event["Method"] = random.choice(METHODS)
            event["Path"] = random.choice(PATHS)
            event["Elapsed"] = random.randrange(3, 400)
            event["UserId"] = _user()
    elif service == "worker":
        job = f"job-{random.randrange(10000, 99999)}"
        if level == "Error":
            event["@mt"] = "Job {JobId} failed"
            event["JobId"] = job
            event["JobType"] = random.choice(JOB_TYPES)
            event["@x"] = random.choice(EXCEPTIONS)
        elif level == "Warning":
            event["@mt"] = "Job {JobId} retry {Attempt}"
            event["JobId"] = job
            event["Attempt"] = random.randrange(1, 4)
        elif level == "Debug":
            event["@mt"] = "Job {JobId} dequeued from {Queue}"
            event["JobId"] = job
            event["Queue"] = random.choice(["default", "bulk"])
        else:
            event["@mt"] = "Processed job {JobType} ({JobId}) in {Elapsed} ms"
            event["JobType"] = random.choice(JOB_TYPES)
            event["JobId"] = job
            event["Elapsed"] = random.randrange(50, 3000)
    elif service == "db":
        # Elapsed is the property slow-operations defaults to, so this feeds the Analysis card
        event["@mt"] = "Query {Name} took {Elapsed} ms"
        event["Name"] = random.choice(QUERIES)
        event["Elapsed"] = random.randrange(300, 1500) if level == "Warning" else random.randrange(2, 120)
    else:
        if level == "Error":
            event["@mt"] = "Account {UserId} locked"
            event["UserId"] = _user()
        elif level == "Warning":
            event["@mt"] = "Failed login for {UserId}"
            event["UserId"] = _user()
            event["Ip"] = _ip()
        else:
            event["@mt"] = "User {UserId} signed in from {Ip}"
            event["UserId"] = _user()
            event["Ip"] = _ip()
    return event


def dry_run():
    """Print the shape without sending: config, the weekday rate table, and sample events."""
    print(f"URL={URL}  EVENTS_PER_DAY={EVENTS_PER_DAY:.0f}  WEEKEND_FACTOR={WEEKEND_FACTOR}")
    names = list(SERVICES)
    print("\nweekday rate table (events/min):")
    print(f"{'hour':>4} " + " ".join(f"{name:>7}" for name in names) + f"{'total':>8}")
    thursday = datetime(2026, 7, 16, 0, tzinfo=timezone.utc)
    for hour in range(24):
        when = thursday.replace(hour=hour)
        rates = [service_rate(name, when) * 60 for name in names]
        print(f"{hour:>4} " + " ".join(f"{rate:>7.1f}" for rate in rates) + f"{sum(rates):>8.1f}")
    daily = sum(service_rate(name, thursday.replace(hour=hour)) * 3600
                for hour in range(24) for name in names)
    print(f"\nweekday total ~{daily:.0f} events/day (EVENTS_PER_DAY={EVENTS_PER_DAY:.0f})")
    print("\nsample events:")
    for _ in range(10):
        service = random.choice(names)
        print(json.dumps(build_event(service, pick_level(service), iso(datetime.now(timezone.utc)))))
```

- [ ] **Step 3: Add a temporary entrypoint so the dry run is runnable**

Append to the file (Task 2 replaces this block):

```python
if __name__ == "__main__":
    dry_run()
```

- [ ] **Step 4: Verify the shape by eye**

Run: `cd test/traffic-sim && python3 traffic-sim.py`

Expected:
- The rate table has 24 rows. With the defaults (`EVENTS_PER_DAY=10000`, `DAY_CURVE` mean 1.548, `WORKER_CURVE` mean 1.1875) the numbers are pinned: `api` averages 3.8/min, peaks at hours 10-11/14 (3.00/1.548 × 3.8 ≈ **7.4/min**) and bottoms out at hours 1-2 (0.25/1.548 × 3.8 ≈ **0.6/min**); `worker` sits flat at (1.0/1.1875 × 1.74 ≈ **1.5/min**) with hour 2 at ≈ **5.9/min** and hour 3 at ≈ **3.7/min**. Numbers far from these mean the normalization is wrong.
- `weekday total ~10000 events/day` — this is the normalization rule; if it drifts from `EVENTS_PER_DAY`, the mean-division in `service_rate` is wrong.
- Ten sample JSON lines, each with `@t`, `@l`, `@mt`, `Source":"traffic-sim"`, `Service`; Error/Fatal lines carry `@x`; api Error lines carry a nested `Cart`.

- [ ] **Step 5: Verify the daily total holds when the curve changes**

Run:
```bash
cd test/traffic-sim && EVENTS_PER_DAY=500 python3 traffic-sim.py | grep "weekday total"
```
Expected: `weekday total ~500 events/day` — the budget scales linearly and the curve shape does not leak into it.

- [ ] **Step 6: Commit**

```bash
git add test/traffic-sim/.env.example test/traffic-sim/traffic-sim.py
git commit -m "test: traffic-sim event shapes and diurnal rate curve"
```

---

### Task 2: The sending loop and resilience

**Files:**
- Modify: `test/traffic-sim/traffic-sim.py` (add imports, `post`, `run`, replace the entrypoint)

**Interfaces:**
- Consumes from Task 1: `URL`, `API_KEY`, `SERVICES`, `iso`, `service_rate`, `pick_level`, `build_event`, `dry_run`.
- Produces: `post(event: dict) -> None` (raises on non-201) and `run() -> None` (never returns).

- [ ] **Step 1: Extend the imports**

Replace the import block at the top of `traffic-sim.py` with:

```python
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
```

- [ ] **Step 2: Add `post` and `run` above the entrypoint**

```python
def post(event):
    """POST one CLEF event; raise unless the server answers 201."""
    request = urllib.request.Request(
        f"{URL}/api/events/raw",
        data=json.dumps(event).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/vnd.serilog.clef", "X-LogHarbor-ApiKey": API_KEY},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 201:
            raise RuntimeError(f"HTTP {response.status}")


def run():
    """Stream until killed. Ingest failures back off but never stop the run."""
    backoff = 1.0
    while True:
        rates = {name: service_rate(name, datetime.now(timezone.utc)) for name in SERVICES}
        time.sleep(random.expovariate(sum(rates.values())))
        service = random.choices(list(rates), weights=list(rates.values()))[0]
        event = build_event(service, pick_level(service), iso(datetime.now(timezone.utc)))
        try:
            post(event)
            backoff = 1.0
        except (urllib.error.URLError, RuntimeError, OSError) as error:
            # a week-long run must survive a container restart, so never exit on ingest failure
            print(f"ingest failed: {error}; retry in {backoff:.0f}s", file=sys.stderr, flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60.0)
```

- [ ] **Step 3: Replace the temporary entrypoint with the real one**

Replace the `if __name__ == "__main__":` block from Task 1 Step 3 with:

```python
if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        dry_run()
        sys.exit(0)
    if not API_KEY:
        sys.exit("set LOGHARBOR_API_KEY (see .env.example)")
    print(f"streaming to {URL} at ~{EVENTS_PER_DAY:.0f} events/day (weekday); Ctrl-C to stop", flush=True)
    try:
        run()
    except KeyboardInterrupt:
        print("stopped", flush=True)
```

- [ ] **Step 4: Verify `--dry-run` still sends nothing and needs no key**

Run: `cd test/traffic-sim && python3 traffic-sim.py --dry-run | tail -3`
Expected: sample JSON lines, no network call, exit 0 even with `LOGHARBOR_API_KEY` unset.

- [ ] **Step 5: Verify the missing-key guard**

Run: `cd test/traffic-sim && python3 traffic-sim.py; echo "exit=$?"`
Expected: prints `set LOGHARBOR_API_KEY (see .env.example)` and `exit=1`.

- [ ] **Step 6: Verify backoff against a closed port (no LogHarbor needed)**

Run:
```bash
cd test/traffic-sim
LOGHARBOR_URL=http://127.0.0.1:9 LOGHARBOR_API_KEY=x EVENTS_PER_DAY=200000 timeout 8 python3 traffic-sim.py; echo "exit=$?"
```
Expected: repeated `ingest failed: ...; retry in 1s` then `2s`, `4s` on stderr — the process keeps running and is killed by `timeout` (`exit=124`), never exiting on its own.

- [ ] **Step 7: Live smoke test against the test server**

Create `.env` from the template with the real key (do NOT commit it), then:
```bash
cd test/traffic-sim
set -a && . ./.env && set +a
before=$(curl -sS "$LOGHARBOR_URL/healthz" | python3 -c 'import sys,json;print(json.load(sys.stdin)["eventCount"])')
EVENTS_PER_DAY=200000 timeout 20 python3 traffic-sim.py
after=$(curl -sS "$LOGHARBOR_URL/healthz" | python3 -c 'import sys,json;print(json.load(sys.stdin)["eventCount"])')
echo "delta=$(( after - before ))"
```
Expected: `delta` is roughly 20-60 (200000/day ≈ 2.3/s, times ~20s, Poisson-noisy) and no `ingest failed` lines. A delta of 0 means the key or URL is wrong.

- [ ] **Step 8: Commit**

```bash
git add test/traffic-sim/traffic-sim.py
git commit -m "test: traffic-sim sending loop with backoff"
```

---

### Task 3: systemd unit, README, and the week-long run

**Files:**
- Create: `test/traffic-sim/traffic-sim.service`
- Create: `test/traffic-sim/README.md`

**Interfaces:**
- Consumes: the finished `traffic-sim.py` and the `.env` contract from Tasks 1-2.
- Produces: the installed unit `traffic-sim` on the test server.

- [ ] **Step 1: Create `test/traffic-sim/traffic-sim.service`**

```ini
[Unit]
Description=LogHarbor traffic simulator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/traffic-sim
EnvironmentFile=/root/traffic-sim/.env
ExecStart=/usr/bin/python3 /root/traffic-sim/traffic-sim.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create `test/traffic-sim/README.md`**

````markdown
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

`api` sleeps at night while `worker` keeps going, and weekends scale to `WEEKEND_FACTOR`, so the
heatmap gets both a daytime band and a weekend gap. `db` carries `Elapsed`, the property
`slow-operations` defaults to, so the Analysis page's "Slower than usual" card sees real data.

Arrivals are Poisson, one event per request, so live tail trickles like a real service instead of
clumping once a minute.

## Requirements

`python3` (stdlib only) and systemd. A LogHarbor ingestion API key — no admin credentials needed.

## Try it without sending anything

```bash
cd test/traffic-sim
python3 traffic-sim.py --dry-run
```

Prints the 24-hour rate table and ten sample events. Use it to sanity-check the shape and the
daily total before committing to a long run.

## Run it

```bash
cp .env.example .env      # then put the real ingestion key in LOGHARBOR_API_KEY
set -a && . ./.env && set +a
python3 traffic-sim.py    # Ctrl-C to stop
```

## Run it for a week (systemd)

```bash
sudo mkdir -p /root/traffic-sim
sudo cp traffic-sim.py .env /root/traffic-sim/
sudo cp traffic-sim.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now traffic-sim
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
sudo systemctl disable --now traffic-sim
```

## Clean up

**There is no delete-events API.** Everything sent stays until retention (default 365 days). Every
event carries `Source="traffic-sim"`, so filter it out with:

```
Source <> 'traffic-sim'
```

or find it with `Source = 'traffic-sim'`.

## Configuration

`.env` (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `LOGHARBOR_URL` | — | base URL of the LogHarbor server |
| `LOGHARBOR_API_KEY` | — | ingestion key |
| `EVENTS_PER_DAY` | 10000 | weekday budget; the hourly curve is normalized so its shape never changes this total |
| `WEEKEND_FACTOR` | 0.5 | Saturday/Sunday multiplier |

Traffic mix, service shares and templates are constants at the top of `traffic-sim.py`
(`DAY_CURVE`, `WORKER_CURVE`, `SERVICES`, `LEVEL_WEIGHTS`).
````

- [ ] **Step 3: Verify the unit file parses**

Run:
```bash
systemd-analyze verify test/traffic-sim/traffic-sim.service 2>&1 | grep -v "Unit .* not found" || echo "unit OK"
```
Expected: no syntax errors. (`EnvironmentFile`/`WorkingDirectory` warnings about missing paths are expected when verifying from the repo — those paths only exist on the server.)

- [ ] **Step 4: Install and start on the test server**

```bash
ssh root@192.168.1.131 'mkdir -p /root/traffic-sim'
scp test/traffic-sim/traffic-sim.py root@192.168.1.131:/root/traffic-sim/
scp test/traffic-sim/traffic-sim.service root@192.168.1.131:/etc/systemd/system/
# .env is NOT in the repo: create it on the server with the real key
ssh root@192.168.1.131 'systemctl daemon-reload && systemctl enable --now traffic-sim && sleep 5 && systemctl is-active traffic-sim'
```
Expected: `active`.

- [ ] **Step 5: Verify events are actually arriving**

```bash
ssh root@192.168.1.131 'journalctl -u traffic-sim -n 5 --no-pager; sleep 60; curl -sS http://127.0.0.1:5000/healthz'
```
Expected: the journal shows the `streaming to ...` line and **no** `ingest failed` lines; `eventCount` in `/healthz` is higher than a minute earlier. In the UI, `Source = 'traffic-sim'` returns fresh events across several `Service` values.

- [ ] **Step 6: Commit**

```bash
git add test/traffic-sim/traffic-sim.service test/traffic-sim/README.md
git commit -m "test: traffic-sim systemd unit and README"
```

---

## Self-Review

**Spec coverage:**
- `test/traffic-sim/` with `traffic-sim.py`, `traffic-sim.service`, `.env.example`, `README.md` → Tasks 1-3. ✓
- Four services with shares, own curves, per-level templates; `Source`/`Service` tags → Task 1 Step 2. ✓
- `api` diurnal / `worker` flat + 02:00 surge / weekend factor → `DAY_CURVE`, `WORKER_CURVE`, `service_rate`. ✓
- `db` carries `Elapsed` to feed slow-operations → Task 1 Step 2 (`db` branch, commented). ✓
- Poisson arrivals, one event per POST, `@t` = now → Task 2 `run`. ✓
- `EVENTS_PER_DAY` default 10000 as a normalized weekday budget → Task 1 Steps 4-5 verify the normalization rule explicitly. ✓
- Resilience: backoff, never exit, `Restart=always` → Task 2 Steps 2/6, Task 3 Step 1. ✓
- Verification by `--dry-run` + live smoke, no Python test stack → Task 1 Step 4, Task 2 Step 7. ✓
- Secrets: `CHANGE_ME` in `.env.example`, real key only in git-ignored `.env` → Task 1 Step 1; no `git add` step ever stages `.env`. ✓
- Nested value for EventDetail; exception text on Error/Fatal → Task 1 `build_event`. ✓

**Placeholder scan:** every code step carries complete code; every verify step carries an exact command and expected output. No TBD/TODO.

**Type consistency:** `iso`/`service_rate`/`pick_level`/`build_event`/`post`/`run` are defined in Task 1-2 and used with matching signatures; `SERVICES` keys (`api`/`worker`/`db`/`auth`) match `LEVEL_WEIGHTS` keys and the `build_event` branches; `.env` variable names match `.env.example`, the module constants, and the README table.
