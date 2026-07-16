# Anomaly Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cron-driven bash+python harness that sends a fixed simulated DB-query log event to LogHarbor with a gradually rising `Elapsed` duration, proving both the `slow-operations` regression detector and a count-based alert webhook fire.

**Architecture:** One `anomaly-sim.sh` with subcommands (`seed-baseline`, `tick`, `setup-alert`, `check`, `reset`) sources a git-ignored `.env` beside it. `seed-baseline` backfills a normal baseline with past `@t` timestamps; cron calls `tick` once a minute to ramp the duration in the live window. A tiny `webhook-listener.py` receives alert webhooks. The harness lives in `test/anomaly-test/` next to the existing `test/scripts/seed-demo.ps1`.

**Tech Stack:** bash, curl, python3 (stdlib only), cron, LogHarbor HTTP API.

## Global Constraints

- **Target runtime:** Linux test server (`http://192.168.1.131:5000`, plain HTTP, `LogHarbor__AllowInsecureCookie=true`). Requires `bash`, `curl`, `python3`, `cron`.
- **Secrets:** committed files carry `CHANGE_ME`; the real ingestion key (the `test1` key) and admin password live only in the git-ignored `.env`. Never commit a real key/password.
- **`.env` is already git-ignored globally** (`.gitignore` line 14). Only `.state` and `webhook.log` need new ignore rules.
- **Grouping:** the operation is one fixed message template (`@mt`); the duration property is **`Elapsed`** (ms) to match the `slow-operations` default (no `property=` override).
- **Tagging:** every event carries `Source="anomaly-sim"`; there is no delete-events API, so this is the only cleanup handle.
- **Auth gate:** only ingestion (`POST /api/events/raw`), `/healthz`, and `/api/auth/*` are open. `GET /api/stats/slow-operations` and `POST /api/signals` / `POST /api/alerts` all require a session cookie. So `check`, `setup-alert` need LogHarbor **admin** creds; only `seed-baseline`/`tick` are key-only.
- **JSON is camelCase:** Signal `{id,title,filter,createdAt}`; SlowOperation `{template,baselineP95,currentP95,count}`; alert request `{title,signalId,thresholdCount,windowMinutes,webhookUrl,isEnabled}` (`signalId` is an integer).
- **Cookie over HTTP:** `AllowInsecureCookie=true` makes `logharbor_session` non-Secure, so `curl -c/-b` replays it over HTTP (no CSRF token needed).

---

### Task 1: Scaffolding — directory, ignore rules, config template, README

**Files:**
- Create: `test/anomaly-test/.env.example`
- Create: `test/anomaly-test/README.md`
- Modify: `.gitignore` (append two lines)

**Interfaces:**
- Produces: the `.env` contract (variable names) every later task's script reads:
  `LOGHARBOR_URL`, `LOGHARBOR_API_KEY`, `LOGHARBOR_ADMIN_USER`, `LOGHARBOR_ADMIN_PASS`,
  `OP_TEMPLATE`, `OP_QUERY`, `BASELINE_MS`, `RAMP_STEP_MS`, `RAMP_MAX_MS`, `JITTER_MS`,
  `BATCH`, `BASELINE_COUNT`, `BASELINE_SPREAD_MIN`, `ALERT_THRESHOLD_MS`, `ALERT_COUNT`,
  `ALERT_WINDOW_MIN`, `WEBHOOK_PORT`, `STATE_FILE`.

- [ ] **Step 1: Append harness runtime files to `.gitignore`**

Append these lines to the end of `.gitignore` (the global `.env` rule already covers `.env`):

```gitignore

# anomaly test harness runtime files
test/anomaly-test/.state
test/anomaly-test/webhook.log
test/anomaly-test/tick.log
```

- [ ] **Step 2: Create `test/anomaly-test/.env.example`**

```bash
# Copy to .env (git-ignored) and fill the CHANGE_ME values. The harness sources this file
# (cron has a bare environment, so config must live here, not in the shell).
LOGHARBOR_URL=http://192.168.1.131:5000

# Ingestion API key — put the real "test1" key here in .env. Repo keeps CHANGE_ME.
LOGHARBOR_API_KEY=CHANGE_ME

# Admin login — needed by `setup-alert` and `check` (GET stats + create signal/alert are
# behind the auth gate). Not needed for seed-baseline/tick.
LOGHARBOR_ADMIN_USER=admin
LOGHARBOR_ADMIN_PASS=CHANGE_ME

# --- operation shape (fixed @mt = one group; Elapsed is the ramped duration in ms) ---
OP_TEMPLATE=DB query {Query} took {Elapsed} ms
OP_QUERY=SELECT * FROM orders WHERE status='open'

# --- ramp ---
BASELINE_MS=60
RAMP_STEP_MS=40
RAMP_MAX_MS=600
JITTER_MS=10
BATCH=8
BASELINE_COUNT=30
BASELINE_SPREAD_MIN=45

# --- alert rule ---
ALERT_THRESHOLD_MS=200
ALERT_COUNT=10
ALERT_WINDOW_MIN=5
WEBHOOK_PORT=9099
```

- [ ] **Step 3: Create `test/anomaly-test/README.md`**

Write this verbatim. The two bottom sections carry blanks that **Task 5 fills** from the live run.

````markdown
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
````

- [ ] **Step 4: Verify files exist and secrets stay untracked**

Run: `ls test/anomaly-test/ && git check-ignore test/anomaly-test/.env test/anomaly-test/.state test/anomaly-test/webhook.log`
Expected: lists `.env.example` and `README.md`; `git check-ignore` echoes all three ignored paths.

- [ ] **Step 5: Commit**

```bash
git add test/anomaly-test/.env.example test/anomaly-test/README.md .gitignore
git commit -m "test: scaffold anomaly harness (config template, README, ignores)"
```

---

### Task 2: `anomaly-sim.sh` — sender core (seed-baseline, tick, reset)

**Files:**
- Create: `test/anomaly-test/anomaly-sim.sh`

**Interfaces:**
- Consumes: the `.env` variables from Task 1.
- Produces: the state file (`.state`, default `$SCRIPT_DIR/.state`) with
  `ANOMALY_START_EPOCH`, `ANOMALY_START_ISO`, `TICK`; helper functions
  `json_escape`, `iso`, `event_line`, `jittered`, `post_batch`; and the command
  dispatch `case` (Task 4 extends it with `check`/`setup-alert`).

- [ ] **Step 1: Write the script**

Create `test/anomaly-test/anomaly-sim.sh`:

```bash
#!/usr/bin/env bash
# LogHarbor anomaly simulator: sends a fixed simulated DB-query event with a gradually
# rising Elapsed (ms) to trip slow-operations regression + an alert webhook.
# Subcommands: seed-baseline | tick | setup-alert | check | reset
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- config (cron has a bare env, so load the .env beside this script) ------
if [ -f "$SCRIPT_DIR/.env" ]; then set -a; . "$SCRIPT_DIR/.env"; set +a; fi

: "${LOGHARBOR_URL:?set LOGHARBOR_URL in .env}"
: "${LOGHARBOR_API_KEY:?set LOGHARBOR_API_KEY in .env}"
OP_TEMPLATE="${OP_TEMPLATE:-DB query {Query} took {Elapsed} ms}"
OP_QUERY="${OP_QUERY:-SELECT * FROM orders WHERE status='open'}"
BASELINE_MS="${BASELINE_MS:-60}"
RAMP_STEP_MS="${RAMP_STEP_MS:-40}"
RAMP_MAX_MS="${RAMP_MAX_MS:-600}"
JITTER_MS="${JITTER_MS:-10}"
BATCH="${BATCH:-8}"
BASELINE_COUNT="${BASELINE_COUNT:-30}"
BASELINE_SPREAD_MIN="${BASELINE_SPREAD_MIN:-45}"
ALERT_THRESHOLD_MS="${ALERT_THRESHOLD_MS:-200}"
ALERT_COUNT="${ALERT_COUNT:-10}"
ALERT_WINDOW_MIN="${ALERT_WINDOW_MIN:-5}"
WEBHOOK_PORT="${WEBHOOK_PORT:-9099}"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.state}"

COOKIEJAR=""
trap 'rm -f "${COOKIEJAR:-}"' EXIT

# --- helpers ----------------------------------------------------------------
json_escape() { local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s"; }

iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%S.000Z; }   # epoch seconds -> ISO-8601 UTC

# one CLEF line: $1 = iso timestamp, $2 = elapsed ms (integer)
event_line() {
  printf '{"@t":"%s","@l":"Information","@mt":"%s","Query":"%s","Elapsed":%s,"Source":"anomaly-sim"}' \
    "$1" "$(json_escape "$OP_TEMPLATE")" "$(json_escape "$OP_QUERY")" "$2"
}

# echo $1 with +/- JITTER_MS noise
jittered() {
  local base=$1 span=$(( JITTER_MS * 2 + 1 ))
  echo $(( base + (RANDOM % span) - JITTER_MS ))
}

# POST newline-joined CLEF batch ($1) to ingestion; assert 201
post_batch() {
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$LOGHARBOR_URL/api/events/raw" \
    -H "X-LogHarbor-ApiKey: $LOGHARBOR_API_KEY" \
    -H "Content-Type: application/vnd.serilog.clef" \
    --data-binary "$1")
  [ "$code" = "201" ] || { echo "ingest failed: HTTP $code" >&2; return 1; }
}

write_state() {
  { echo "ANOMALY_START_EPOCH=$1"
    echo "ANOMALY_START_ISO=$2"
    echo "TICK=$3"; } > "$STATE_FILE"
}

# --- subcommands ------------------------------------------------------------
cmd_seed_baseline() {
  local now step body="" i ts el
  now=$(date -u +%s)
  step=$(( BASELINE_SPREAD_MIN * 60 / BASELINE_COUNT ))
  for (( i=0; i<BASELINE_COUNT; i++ )); do
    ts=$(( now - 60 - i * step ))          # all strictly in the past
    el=$(jittered "$BASELINE_MS")
    body+="$(event_line "$(iso "$ts")" "$el")"$'\n'
  done
  post_batch "$body"
  write_state "$now" "$(iso "$now")" 0
  echo "seeded $BASELINE_COUNT baseline events (~${BASELINE_MS}ms); anomaly window starts $(iso "$now")"
}

cmd_tick() {
  [ -f "$STATE_FILE" ] || { echo "no state; run seed-baseline first" >&2; exit 1; }
  . "$STATE_FILE"
  local ramp body="" i el ts
  ramp=$(( BASELINE_MS + TICK * RAMP_STEP_MS ))
  if (( ramp > RAMP_MAX_MS )); then ramp=$RAMP_MAX_MS; fi
  ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  for (( i=0; i<BATCH; i++ )); do
    el=$(jittered "$ramp")
    body+="$(event_line "$ts" "$el")"$'\n'
  done
  post_batch "$body"
  write_state "$ANOMALY_START_EPOCH" "$ANOMALY_START_ISO" "$(( TICK + 1 ))"
  echo "tick $TICK: sent $BATCH events at ~${ramp}ms"
}

cmd_reset() {
  rm -f "$STATE_FILE"
  echo "state cleared. Ingested events remain; filter them with: Source = 'anomaly-sim'"
}

case "${1:-}" in
  seed-baseline) cmd_seed_baseline ;;
  tick)          cmd_tick ;;
  reset)         cmd_reset ;;
  *) echo "usage: $0 {seed-baseline|tick|setup-alert|check|reset}" >&2; exit 2 ;;
esac
```

- [ ] **Step 2: Make it executable and syntax-check**

Run: `chmod +x test/anomaly-test/anomaly-sim.sh && bash -n test/anomaly-test/anomaly-sim.sh && echo OK`
Expected: `OK` (no syntax errors).

- [ ] **Step 3: Live smoke test against the server**

Create `.env` from the template with the real key (do NOT commit it), then:

Run:
```bash
cd test/anomaly-test
before=$(curl -sS "$LOGHARBOR_URL/healthz" | python3 -c 'import sys,json;print(json.load(sys.stdin)["eventCount"])')
./anomaly-sim.sh seed-baseline
./anomaly-sim.sh tick
./anomaly-sim.sh tick
after=$(curl -sS "$LOGHARBOR_URL/healthz" | python3 -c 'import sys,json;print(json.load(sys.stdin)["eventCount"])')
echo "delta=$(( after - before )) ; state:"; cat .state
```
Expected: `seed-baseline` prints "seeded 30 baseline events…"; two ticks print "tick 0 … ~60ms" and "tick 1 … ~100ms"; `delta=46` (30 + 8 + 8); `.state` shows `TICK=2`.

- [ ] **Step 4: Commit**

```bash
git add test/anomaly-test/anomaly-sim.sh
git commit -m "test: anomaly-sim sender core (seed-baseline, tick, reset)"
```

---

### Task 3: `webhook-listener.py` — alert receiver

**Files:**
- Create: `test/anomaly-test/webhook-listener.py`

**Interfaces:**
- Consumes: nothing from the harness; takes an optional port arg (default 9099).
- Produces: `webhook.log` (append-only) in the current directory, one line per POST:
  `<utc-iso>  <path>  <body>`.

- [ ] **Step 1: Write the listener**

Create `test/anomaly-test/webhook-listener.py`:

```python
#!/usr/bin/env python3
"""Minimal webhook receiver for the anomaly test harness.

Appends each POST body (LogHarbor alert payload) to webhook.log with a UTC timestamp
and echoes it. Binds 127.0.0.1 only (the alert evaluator runs on the same host).
Usage: python3 webhook-listener.py [port]   # default 9099
"""
import datetime
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9099
LOG = "webhook.log"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "replace")
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        line = f"{stamp}  {self.path}  {body}\n"
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(line)
        print(line, end="", flush=True)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args):  # silence default access logging
        pass


if __name__ == "__main__":
    print(f"listening on 127.0.0.1:{PORT}, appending to {LOG}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
```

- [ ] **Step 2: Byte-compile check**

Run: `python3 -m py_compile test/anomaly-test/webhook-listener.py && echo OK`
Expected: `OK` (no syntax errors).

- [ ] **Step 3: Round-trip test**

Run:
```bash
cd test/anomaly-test
python3 webhook-listener.py 9099 &
sleep 1
curl -sS -o /dev/null -X POST http://127.0.0.1:9099/ -d '{"probe":true}'
sleep 1
kill %1
cat webhook.log
```
Expected: `webhook.log` has one line ending `/  {"probe":true}`. (Delete this probe line before the real run, or just let Task 5 append.)

- [ ] **Step 4: Commit**

```bash
git add test/anomaly-test/webhook-listener.py
git commit -m "test: webhook listener for anomaly alert delivery"
```

---

### Task 4: `anomaly-sim.sh` — login helper, check, setup-alert

**Files:**
- Modify: `test/anomaly-test/anomaly-sim.sh` (add `login`, `cmd_check`, `cmd_setup_alert`; extend the dispatch `case`)

**Interfaces:**
- Consumes: `login` populates the global `COOKIEJAR` (a mktemp cookie jar) from
  `LOGHARBOR_ADMIN_USER`/`LOGHARBOR_ADMIN_PASS`; `ANOMALY_START_ISO` from the state file.
- Produces: `check` (prints DETECTED/not-yet) and `setup-alert` (creates the
  `anomaly-sim slow` signal + `anomaly-sim alert` rule, idempotently).

- [ ] **Step 1: Add the `login` helper after `post_batch`**

Insert this function right after the `post_batch` function:

```bash
# log in as admin, storing the session cookie in $COOKIEJAR (assert 200)
login() {
  : "${LOGHARBOR_ADMIN_USER:?set LOGHARBOR_ADMIN_USER in .env}"
  : "${LOGHARBOR_ADMIN_PASS:?set LOGHARBOR_ADMIN_PASS in .env}"
  COOKIEJAR=$(mktemp)
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIEJAR" \
    -X POST "$LOGHARBOR_URL/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$LOGHARBOR_ADMIN_USER\",\"password\":\"$LOGHARBOR_ADMIN_PASS\"}")
  [ "$code" = "200" ] || { echo "login failed: HTTP $code" >&2; return 1; }
}
```

- [ ] **Step 2: Add `cmd_check` and `cmd_setup_alert` before the `case`**

Insert these two functions just above the `case "${1:-}" in` line:

```bash
cmd_check() {
  [ -f "$STATE_FILE" ] || { echo "no state; run seed-baseline first" >&2; exit 1; }
  . "$STATE_FILE"
  login
  local to
  to=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  curl -sS -b "$COOKIEJAR" \
    "$LOGHARBOR_URL/api/stats/slow-operations?from=$ANOMALY_START_ISO&to=$to&minSamples=10&floorMs=40" \
  | python3 - <<'PY'
import sys, json
ops = json.load(sys.stdin).get("operations", [])
if not ops:
    print("  not yet: no operation is >=2x its baseline in this window")
for o in ops:
    base = o["baselineP95"]; now = o["currentP95"]
    ratio = now / base if base else 0
    print(f'  DETECTED: {o["template"]}  baseline={base:.0f}ms  now={now:.0f}ms  '
          f'x{ratio:.1f}  (n={o["count"]})')
PY
}

cmd_setup_alert() {
  login
  local sid
  # reuse an existing "anomaly-sim slow" signal, else create it
  sid=$(curl -sS -b "$COOKIEJAR" "$LOGHARBOR_URL/api/signals" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(next((s["id"] for s in d if s["title"]=="anomaly-sim slow"), ""))')
  if [ -z "$sid" ]; then
    sid=$(curl -sS -b "$COOKIEJAR" -X POST "$LOGHARBOR_URL/api/signals" \
      -H 'Content-Type: application/json' \
      -d "{\"title\":\"anomaly-sim slow\",\"filter\":\"Elapsed > $ALERT_THRESHOLD_MS\"}" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
  fi
  # create the alert rule unless one with our title already exists
  local exists
  exists=$(curl -sS -b "$COOKIEJAR" "$LOGHARBOR_URL/api/alerts" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(any(a["title"]=="anomaly-sim alert" for a in d))')
  if [ "$exists" = "True" ]; then
    echo "alert 'anomaly-sim alert' already exists (signal id=$sid)"
  else
    curl -sS -o /dev/null -w 'alert create: HTTP %{http_code}\n' -b "$COOKIEJAR" \
      -X POST "$LOGHARBOR_URL/api/alerts" -H 'Content-Type: application/json' \
      -d "{\"title\":\"anomaly-sim alert\",\"signalId\":$sid,\"thresholdCount\":$ALERT_COUNT,\"windowMinutes\":$ALERT_WINDOW_MIN,\"webhookUrl\":\"http://127.0.0.1:$WEBHOOK_PORT/\",\"isEnabled\":true}"
  fi
  echo "signal id=$sid ('Elapsed > $ALERT_THRESHOLD_MS') -> webhook http://127.0.0.1:$WEBHOOK_PORT/"
}
```

- [ ] **Step 3: Extend the dispatch `case` with the two new commands**

Replace the `case` block at the bottom with:

```bash
case "${1:-}" in
  seed-baseline) cmd_seed_baseline ;;
  tick)          cmd_tick ;;
  setup-alert)   cmd_setup_alert ;;
  check)         cmd_check ;;
  reset)         cmd_reset ;;
  *) echo "usage: $0 {seed-baseline|tick|setup-alert|check|reset}" >&2; exit 2 ;;
esac
```

- [ ] **Step 4: Syntax-check**

Run: `bash -n test/anomaly-test/anomaly-sim.sh && echo OK`
Expected: `OK`.

- [ ] **Step 5: Live smoke test (needs admin creds in `.env`)**

Run:
```bash
cd test/anomaly-test
./anomaly-sim.sh setup-alert
./anomaly-sim.sh check
```
Expected: `setup-alert` prints `alert create: HTTP 201` (or "already exists") and `signal id=<n> …`; `check` prints either a `DETECTED:` line or `not yet:` (both are valid depending on how far the ramp has climbed). No `login failed` / `HTTP 401`.

- [ ] **Step 6: Commit**

```bash
git add test/anomaly-test/anomaly-sim.sh
git commit -m "test: anomaly-sim check + setup-alert (auth, signal, alert)"
```

---

### Task 5: Live end-to-end run + record observations in the README

**Files:**
- Modify: `test/anomaly-test/README.md` (fill "Test Results & Observations" and "LogHarbor Improvement Opportunities")

**Interfaces:**
- Consumes: the finished harness (Tasks 1-4) and a reachable test server with admin creds.
- Produces: a documented run with empirical timings and confirmed/added findings.

**Prerequisite:** a shell with network access to `http://192.168.1.131:5000` (and, for the
cron/listener half, access to run them on that host — e.g. `ssh root@192.168.1.131`), plus
`.env` filled with the real `test1` key and admin password. If admin creds are unavailable
to the executor, run `setup-alert`/`check` interactively with the user, or verify the
slow-operations half only and note the alert half as user-run.

- [ ] **Step 1: Start the run**

On the test server, in the harness directory with `.env` filled:
```bash
python3 webhook-listener.py &          # -> webhook.log
./anomaly-sim.sh seed-baseline
./anomaly-sim.sh setup-alert
# install cron, or drive it manually every ~60s if watching live:
( crontab -l 2>/dev/null; echo "* * * * * cd $PWD && ./anomaly-sim.sh tick >> tick.log 2>&1" ) | crontab -
```
Expected: baseline seeded; `alert create: HTTP 201`; a crontab entry running `tick`.

- [ ] **Step 2: Watch until both detectors fire (~10 min)**

Run periodically:
```bash
./anomaly-sim.sh check
tail -n 3 webhook.log 2>/dev/null
```
Record: the tick/minute at which `check` first prints `DETECTED:` and its `×slower`; the
time `webhook.log` first receives an alert POST and a short excerpt of its body. Also open
the Analysis page → "Slower than usual" and confirm the operation is listed.

- [ ] **Step 3: Fill the README "Test Results & Observations" section**

Replace the blanks with the recorded numbers. Example shape (use real values):
```markdown
- **slow-operations first flagged:** tick 5, ~5 min in, ×2.4 (baseline 64 ms → now 154 ms).
- **Alert webhook first fired:** ~8 min in; payload excerpt: `"count":13,"threshold":10,"windowMinutes":5`.
- **Ramp curve observed:** 60 → 100 → 140 → … → 600 ms; ×slower rose to ~9× at the cap.
```

- [ ] **Step 4: Fill the "LogHarbor Improvement Opportunities" section**

Keep the pre-listed candidates that held true, delete any that didn't, and add anything the
run surfaced (e.g. `minSamples`/`floorMs` defaults feeling high for low-volume services, the
need to hand-pick `from`, alert cooldown behaviour, UI clarity of "Slower than usual"). Each
bullet: what was observed and why it's worth a product change.

- [ ] **Step 5: Tear down and commit the documented README**

```bash
crontab -l | grep -v anomaly-sim | crontab -   # remove the cron line
kill %1                                          # stop the listener
git add test/anomaly-test/README.md
git commit -m "test: record anomaly harness run results and LogHarbor findings"
```

---

## Self-Review

**Spec coverage:**
- Hybrid baseline (backfill + live ramp) → Task 2 (`seed-baseline` past `@t`, `tick` ramp). ✓
- Both detectors → slow-operations via Task 4 `check`; alert webhook via Task 3 listener + Task 4 `setup-alert`. ✓
- `test/anomaly-test/` location, `Elapsed` property, `Source` tag, `CHANGE_ME` secrets → Tasks 1-2. ✓
- README with observation + improvement sections, filled from a live run → Tasks 1 & 5. ✓
- Auth gate on stats → `login` helper shared by `check`/`setup-alert` (Task 4). ✓
- `.gitignore` for `.state`/`webhook.log` (`.env` already global) → Task 1. ✓

**Placeholder scan:** README's blanks are runtime data filled by Task 5, not plan gaps; every code step carries complete code. No TBD/TODO in the plan.

**Type consistency:** `signalId` integer (from `Signal.id` long); alert body keys match `AlertRule`; slow-operations JSON keys `template/baselineP95/currentP95/count` match `SlowOperation` camelCased; state vars `ANOMALY_START_EPOCH/ANOMALY_START_ISO/TICK` written by `write_state` and read by `cmd_tick`/`cmd_check` consistently; `COOKIEJAR` set by `login`, used by `cmd_check`/`cmd_setup_alert`.
