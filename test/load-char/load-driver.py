#!/usr/bin/env python3
"""Sustained CLEF + OTLP ingest driver for load characterization (stdlib only).

Drives two phases of mixed CLEF and OTLP/JSON batches against LogHarbor and
records one JSON line per request (phase, kind, status, latency ms) plus a
final {"summary": ...} line. Reads LOGHARBOR_URL and LOGHARBOR_API_KEY from
the environment — the same contract as traffic-sim — and never prints the key.

Every event carries Source="load-char" / service.name="load-char" so the run
can be filtered (and cleaned up) afterwards.
"""

import argparse
import json
import os
import queue
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def clef_batch(seq: int, size: int) -> bytes:
    lines = []
    for i in range(size):
        level = random.choices(["Information", "Warning", "Error"], weights=[90, 8, 2])[0]
        event = {
            "@t": iso_now(),
            "@l": level,
            "@mt": "Load op {OpId} took {Elapsed} ms",
            "Source": "load-char",
            "Service": "load",
            "OpId": seq * size + i,
            "Elapsed": round(random.lognormvariate(3.4, 0.6), 1),
        }
        if level == "Error":
            event["@x"] = "System.TimeoutException: simulated timeout\n   at Load.Op()"
        lines.append(json.dumps(event))
    return "\n".join(lines).encode()


def otlp_batch(seq: int, size: int) -> bytes:
    now_ns = time.time_ns()
    records = [
        {
            "timeUnixNano": str(now_ns + i),
            "severityNumber": 9,
            "body": {"stringValue": f"load op {seq * size + i}"},
            "attributes": [
                {"key": "OpId", "value": {"intValue": str(seq * size + i)}},
                {"key": "Elapsed", "value": {"doubleValue": round(random.lognormvariate(3.4, 0.6), 1)}},
            ],
        }
        for i in range(size)
    ]
    payload = {
        "resourceLogs": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "load-char"}},
                        {"key": "Source", "value": {"stringValue": "load-char"}},
                    ]
                },
                "scopeLogs": [{"logRecords": records}],
            }
        ]
    }
    return json.dumps(payload).encode()


def send(base_url: str, key: str, kind: str, body: bytes):
    path, ctype = (
        ("/api/events/raw", "application/vnd.serilog.clef")
        if kind == "clef"
        else ("/v1/logs", "application/json")
    )
    request = urllib.request.Request(
        base_url + path, data=body, method="POST",
        headers={"Content-Type": ctype, "X-LogHarbor-ApiKey": key},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, error = response.status, None
            response.read()
    except urllib.error.HTTPError as http_error:
        status, error = http_error.code, None
        http_error.read()
    except Exception as exception:  # timeout, connection refused, ...
        status, error = None, repr(exception)
    return status, (time.perf_counter() - started) * 1000.0, error


def percentile(sorted_values, fraction):
    if not sorted_values:
        return None
    index = min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1))))
    return round(sorted_values[index], 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase1-rate", type=float, default=300, help="events/s (default 300)")
    parser.add_argument("--phase1-duration", type=float, default=900, help="seconds (default 900)")
    parser.add_argument("--phase1-batch", type=int, default=100)
    parser.add_argument("--phase2-rate", type=float, default=1000, help="events/s (default 1000; 0 disables)")
    parser.add_argument("--phase2-duration", type=float, default=270)
    parser.add_argument("--phase2-batch", type=int, default=200)
    parser.add_argument("--otlp-share", type=float, default=0.5)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--out", default="/root/load-char/results.jsonl")
    args = parser.parse_args()

    base_url = os.environ.get("LOGHARBOR_URL", "").rstrip("/")
    key = os.environ.get("LOGHARBOR_API_KEY", "")
    if not base_url or not key or key == "CHANGE_ME":
        print("LOGHARBOR_URL / LOGHARBOR_API_KEY missing in environment", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    out = open(args.out, "a", buffering=1)
    out_lock = threading.Lock()
    jobs: "queue.Queue" = queue.Queue(maxsize=64)
    results = []

    def worker():
        while True:
            job = jobs.get()
            if job is None:
                return
            target, phase, kind, size, body = job
            delay = target - time.time()
            if delay > 0:
                time.sleep(delay)
            status, latency_ms, error = send(base_url, key, kind, body)
            record = {
                "ts": round(time.time(), 3), "phase": phase, "kind": kind, "n": size,
                "status": status, "ms": round(latency_ms, 1),
            }
            if error:
                record["error"] = error
            with out_lock:
                out.write(json.dumps(record) + "\n")
                results.append(record)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(args.workers)]
    for thread in threads:
        thread.start()

    def run_phase(phase, rate, duration, batch):
        if rate <= 0 or duration <= 0:
            return
        total_batches = int(rate * duration / batch)
        interval = batch / rate
        start = time.time()
        print(f"phase {phase}: {rate:g} ev/s for {duration:g}s "
              f"({total_batches} batches of {batch})", flush=True)
        for sequence in range(total_batches):
            kind = "otlp" if random.random() < args.otlp_share else "clef"
            body = otlp_batch(sequence, batch) if kind == "otlp" else clef_batch(sequence, batch)
            jobs.put((start + sequence * interval, phase, kind, batch, body))

    overall_start = time.time()
    run_phase(1, args.phase1_rate, args.phase1_duration, args.phase1_batch)
    run_phase(2, args.phase2_rate, args.phase2_duration, args.phase2_batch)
    for _ in threads:
        jobs.put(None)
    for thread in threads:
        thread.join()

    summary = {"summary": {"wall_s": round(time.time() - overall_start, 1), "phases": {}}}
    for phase in sorted({r["phase"] for r in results}):
        phase_rows = [r for r in results if r["phase"] == phase]
        per_kind = {}
        for kind in ("clef", "otlp"):
            rows = [r for r in phase_rows if r["kind"] == kind]
            if not rows:
                continue
            ok = [r for r in rows if r["status"] in (200, 201)]
            latencies = sorted(r["ms"] for r in ok)
            span = max(r["ts"] for r in rows) - min(r["ts"] for r in rows) or 1
            per_kind[kind] = {
                "batches": len(rows),
                "events_ok": sum(r["n"] for r in ok),
                "errors": len(rows) - len(ok),
                "p50_ms": percentile(latencies, 0.50),
                "p90_ms": percentile(latencies, 0.90),
                "p99_ms": percentile(latencies, 0.99),
                "max_ms": percentile(latencies, 1.0),
                "achieved_ev_s": round(sum(r["n"] for r in ok) / span, 1),
            }
        summary["summary"]["phases"][str(phase)] = per_kind
    out.write(json.dumps(summary) + "\n")
    out.close()
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
