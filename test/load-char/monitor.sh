#!/bin/sh
# Samples server-side vitals while load-driver.py runs: healthz (eventCount,
# dbSizeBytes), container CPU/mem, and a timed read-only SQLite query (does
# reader latency survive write load — the WAL promise). One JSON line per
# sample. Stops when the driver has written its summary and exited, or at the
# time budget. No secrets involved.
#
# usage: monitor.sh [out.jsonl] [budget_seconds]
OUT=${1:-/root/load-char/monitor.jsonl}
BUDGET=${2:-3000}
DB="$(docker volume inspect logharbor_logharbor-data --format '{{.Mountpoint}}')/logharbor.db"
END=$(( $(date +%s) + BUDGET ))
mkdir -p "$(dirname "$OUT")"

while [ "$(date +%s)" -lt "$END" ]; do
  HEALTH=$(curl -fsS -m 5 http://localhost:5000/healthz 2>/dev/null || echo '{}')
  STATS=$(docker stats logharbor --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' 2>/dev/null)
  READ_MS=$(python3 - "$DB" <<'PYEOF'
import sqlite3, sys, time
t0 = time.perf_counter()
try:
    c = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True, timeout=5)
    c.execute("SELECT COUNT(*) FROM events WHERE id > (SELECT MAX(id) - 50000 FROM events)").fetchone()
    print(round((time.perf_counter() - t0) * 1000, 1))
except Exception:
    print(-1)
PYEOF
)
  echo "{\"ts\":$(date +%s),\"health\":$HEALTH,\"stats\":\"$STATS\",\"read_ms\":$READ_MS}" >> "$OUT"
  if ! pgrep -f load-driver.py >/dev/null 2>&1 \
     && grep -q '"summary"' /root/load-char/results.jsonl 2>/dev/null; then
    break
  fi
  sleep 15
done
