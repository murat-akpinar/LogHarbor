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

case "${1:-}" in
  seed-baseline) cmd_seed_baseline ;;
  tick)          cmd_tick ;;
  setup-alert)   cmd_setup_alert ;;
  check)         cmd_check ;;
  reset)         cmd_reset ;;
  *) echo "usage: $0 {seed-baseline|tick|setup-alert|check|reset}" >&2; exit 2 ;;
esac
