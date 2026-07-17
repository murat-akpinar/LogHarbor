# Load Characterization

Answers one question with data: does the ingestion write path need the
background-channel refactor now, or can it wait? (todo.md Phase 13.)

Two tools, stdlib/POSIX only, run against the test server:

| File | Purpose |
|---|---|
| `load-driver.py` | two-phase sustained CLEF + OTLP/JSON ingest (default: 300 ev/s for 15 min, then 1000 ev/s for 4.5 min, 50/50 mix, 6 concurrent senders); records per-request latency and a summary |
| `monitor.sh` | server-side sampler: healthz, container CPU/mem, timed read-only query every 15 s |

Every event carries `Source="load-char"` (CLEF) / `service.name="load-char"`
(OTLP) so the run is filterable and removable afterwards. Take a snapshot
first (`VACUUM INTO`, or GET /api/admin/backup) if you want to restore the
pre-test state.

## Run

```bash
# on the server; key comes from the traffic-sim env contract, never printed
set -a; . /root/traffic-sim/.env; set +a
mkdir -p /root/load-char
sh /app/logharbor/test/load-char/monitor.sh /root/load-char/monitor.jsonl 3000 &
nohup python3 /app/logharbor/test/load-char/load-driver.py \
  --out /root/load-char/results.jsonl > /root/load-char/driver.log 2>&1 &
```

Batch sizes keep the POST rate far under the per-key ingest rate limit
(default 1200/min): phase 1 is ~180 POST/min, phase 2 ~300 POST/min.

Results: `results.jsonl` ends with a `{"summary": ...}` line (per phase and
per encoding: batches, events, errors, p50/p90/p99/max latency, achieved
events/s); `monitor.jsonl` gives the server-side view over time.
