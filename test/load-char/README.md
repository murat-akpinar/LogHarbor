# Load Characterization

Answers one question with data: **does the ingestion write path need the
background-channel refactor, or can it wait?** (todo.md Phase 13 — the
channel idea comes from architecture.md's "next step when volume grows".)

Verdict from the 2026-07-18 run: **it can wait.** Numbers below.

## Tools

Stdlib/POSIX only, same `.env` contract as `traffic-sim`
(`LOGHARBOR_URL`, `LOGHARBOR_API_KEY`); the key is never printed.

| File | Purpose |
|---|---|
| `load-driver.py` | two-phase sustained CLEF + OTLP/JSON ingest (defaults: 300 ev/s for 15 min, then 1000 ev/s for 4.5 min; 50/50 encoding mix; 6 concurrent senders) recording per-request latency plus a final `{"summary": ...}` |
| `monitor.sh` | server-side sampler: healthz, container CPU/mem, timed read-only SQLite query, every 15 s |

Every event carries `Source="load-char"` (CLEF) / `service.name="load-char"`
(OTLP) so the run is filterable afterwards (`Source <> 'load-char'`). There is
no delete-events API — snapshot first if you want the pre-test state back.

## Run

```bash
# on the server
# 1. consistent pre-test snapshot, safe while the server runs
MP=$(docker volume inspect logharbor_logharbor-data --format '{{.Mountpoint}}')
python3 -c "import sqlite3; sqlite3.connect('file:$MP/logharbor.db?mode=ro', uri=True) \
  .execute(\"VACUUM INTO '/root/load-char-pretest.db'\")"

# 2. key from the traffic-sim env contract; monitor + driver in the background
set -a; . /root/traffic-sim/.env; set +a
mkdir -p /root/load-char
nohup sh /app/logharbor/test/load-char/monitor.sh /root/load-char/monitor.jsonl 3000 >/dev/null 2>&1 &
nohup python3 /app/logharbor/test/load-char/load-driver.py \
  --out /root/load-char/results.jsonl > /root/load-char/driver.log 2>&1 &
```

Batch sizes keep the POST rate far under the per-key ingest rate limit
(default 1200/min): phase 1 is ~180 POST/min, phase 2 ~300 POST/min.
`results.jsonl` ends with the summary; `monitor.jsonl` is the server-side
view over time.

## Results — 2026-07-18 run

Test server 192.168.1.131 (Docker, SQLite on a named volume), baseline
12,815 events / 5.3 MB, traffic-sim's ambient ~7 ev/min running throughout.

| | Phase 1 — 300 ev/s, 15 min | Phase 2 — 1000 ev/s, 4.5 min |
|---|---|---|
| Achieved throughput | ~300 ev/s (150.5 + 149.9) | ~1089 ev/s (560.6 + 528.2) |
| Errors (non-2xx, timeouts) | **0** | **0** |
| Batch latency p50 | 7.3–7.4 ms (100 events) | 13.9–14.5 ms (200 events) |
| Batch latency p90 | 10.1–10.5 ms | 26.5–37.0 ms |
| Batch latency p99 | 41.7–42.1 ms | 88.1–89.5 ms |
| Batch latency max | 81 ms / 1.12 s (one outlier) | 1.16 s (one outlier) |

- **540,000 events in 19.1 min, zero rejections.**
- DB growth 5.3 MB → 181.8 MB ≈ **342 bytes/event** including FTS.
- CLEF vs OTLP: statistically indistinguishable — encoding is not a factor.
- Post-load: a 50k-row COUNT answers in **8.4 ms** on the 553k-row DB;
  container at 108 MiB RSS, idle CPU 0.3 %.
- Marginal write cost ≈ 0.07 ms/event at both operating points — the writer
  was nowhere near saturation even at 1000 ev/s (≈ 86M events/day pace).

**Interpretation:** the current write path (per-request `WriteBatch`, SQLite
WAL) holds a p99 under 90 ms at 1000 ev/s sustained with six concurrent
senders. That is two to three orders of magnitude above realistic traffic
for this class of deployment, so the channel refactor stays parked. The
signal to revisit is a real deployment showing ingest p99 degradation or
`SQLITE_BUSY` retries — not throughput.

### Caveats

- Senders batched 100–200 events/POST, as real sinks do. Unbatched
  1-event-per-POST at high concurrency was not tested — the per-key rate
  limit throttles that shape long before the writer would.
- The during-load monitor samples were lost to a CRLF bug (`git archive` on
  Windows; fixed via `.gitattributes eol=lf`), so CPU/read latency **under**
  load were not captured. Ingest latencies and post-load reads bound the
  impact well enough for this decision. **Captured in the 2026-07-26 re-run
  below.**
- Single instance, single API key, LAN client.

## Re-run — 2026-07-26

Same driver, same defaults, same host. Run because the write path had gained
work since: Phase 19 added rejection recording and write-failure tracking to
every ingest request, and nobody had checked what that cost. Ran on a
throwaway instance built from the `v0.1.0` tag (empty database, matching the
2026-07-18 baseline's near-empty start) rather than the live one, whose
100 MB size ceiling would have started dropping real archived days.

| | 2026-07-18 | 2026-07-26 |
|---|---|---|
| Phase 1 throughput | ~300 ev/s | ~300 ev/s |
| Phase 1 p50 / p90 / p99 | 7.3–7.4 / 10.1–10.5 / 41.7–42.1 ms | 6.9–7.0 / 9.8–10.4 / 41.2–42.2 ms |
| Phase 2 throughput | ~1089 ev/s | ~1089 ev/s |
| Phase 2 p50 / p90 | 13.9–14.5 / 26.5–37.0 ms | 13.1–13.2 / 23.0–31.5 ms |
| Phase 2 p99 | 88.1–89.5 ms | 59.8 (CLEF) / 109.2 (OTLP) |
| Errors | **0** | **0** |
| Bytes/event incl. FTS | ~342 | ~332 |

**No regression.** p50 and p90 came in slightly lower; p99 moved in opposite
directions for the two encodings (CLEF down 28 ms, OTLP up 20 ms), which is
single-run tail noise rather than a systematic change — the encodings were
statistically indistinguishable in 2026-07-18 and nothing in the added code
is encoding-specific. 540,000 events, zero rejections, `lastWriteFailure`
null throughout.

The monitor samples survived this time (112 of them), which answers what the
first run could not:

- **Read latency under write load:** 1.7 ms min / 6.6 ms median / **16.0 ms
  max** for the 50k-row COUNT, sampled every 15 s throughout both phases. The
  WAL promise holds — readers were never blocked by the writer.
- **Container CPU:** 2.3 % median, **42 % peak** on a 2-core host that was
  also running the live instance. Memory settled at 85 MiB.

The parked verdict stands, now on three data points. The unpark signal is
unchanged: ingest p99 degradation or `SQLITE_BUSY` retries on a real
deployment. Still untested at load: a database that is already large — the
live instance's 33,000-event batch in 4.0 s (2026-07-25) is the only
measurement of that shape.
