#!/usr/bin/env python3
"""One-shot backfill of EF Core-shaped DB query events for the /queries page.

Sends `--count` events spread over the last `--minutes` minutes: a handful of
canned SQL statements with distinct call-rate and latency profiles (a hot cheap
lookup, a slow join, occasional timeouts as Error events), so the Queries page
shows a realistic spread of Calls / Total / AVG / P95 immediately.

Reads LOGHARBOR_URL and LOGHARBOR_API_KEY from the environment, falling back to
a git-ignored .env file next to this script (KEY=VALUE lines).
"""

import argparse
import json
import os
import random
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BATCH_LINES = 200
SOURCE = "db-query-sim"

# (sql, weight, elapsed_low_ms, elapsed_high_ms, connection)
PROFILES = [
    ("SELECT * FROM orders WHERE id = @p0", 40, 2, 25, "main"),
    ("SELECT * FROM users WHERE email = @p0", 25, 3, 40, "replica"),
    ("UPDATE orders SET status = @p0 WHERE id = @p1", 12, 5, 60, "main"),
    ("INSERT INTO audit_log (user_id, action) VALUES (@p0, @p1)", 10, 2, 15, "main"),
    ("SELECT o.*, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.created_at > @p0", 8, 80, 900, "replica"),
    ("DELETE FROM sessions WHERE expires_at < @p0", 5, 10, 120, "main"),
]

TIMEOUT_EXCEPTION = (
    "Npgsql.NpgsqlException: Exception while reading from stream\n"
    " ---> System.TimeoutException: Timeout during reading attempt\n"
    "   at Api.Db.Database.Query() in /src/Api/Db/Database.cs:line 41"
)


def load_env_file() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def iso(when: datetime) -> str:
    return when.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def build_event(when: datetime, error_rate: float) -> dict:
    sql, _, low, high, connection = random.choices(PROFILES, weights=[p[1] for p in PROFILES])[0]
    event = {
        "@t": iso(when),
        "@mt": "Executed DbCommand ({elapsed}ms) {commandText}",
        "commandText": sql,
        "elapsed": random.randrange(low, high + 1),
        "connection": connection,
        "Source": SOURCE,
        "Service": "api",
    }
    if random.random() < error_rate:
        event["@l"] = "Error"
        event["@x"] = TIMEOUT_EXCEPTION
        event["elapsed"] = random.randrange(5000, 30001)  # a timeout dwarfs normal latency
    return event


def post_batch(url: str, api_key: str, lines: list[str]) -> None:
    request = urllib.request.Request(
        f"{url.rstrip('/')}/api/events/raw",
        data="\n".join(lines).encode("utf-8"),
        headers={
            "X-LogHarbor-ApiKey": api_key,
            "Content-Type": "application/vnd.serilog.clef",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=400, help="events to send (default 400)")
    parser.add_argument("--minutes", type=int, default=60, help="spread over the last N minutes (default 60)")
    parser.add_argument("--error-rate", type=float, default=0.03, help="share of Error-level timeouts (default 0.03)")
    args = parser.parse_args()

    load_env_file()
    url = os.environ.get("LOGHARBOR_URL", "")
    api_key = os.environ.get("LOGHARBOR_API_KEY", "")
    if not url or not api_key:
        raise SystemExit("Set LOGHARBOR_URL and LOGHARBOR_API_KEY (env or .env next to this script).")

    now = datetime.now(timezone.utc)
    stamps = sorted(now - timedelta(seconds=random.uniform(0, args.minutes * 60)) for _ in range(args.count))
    lines = [json.dumps(build_event(when, args.error_rate)) for when in stamps]

    for start in range(0, len(lines), BATCH_LINES):
        post_batch(url, api_key, lines[start : start + BATCH_LINES])

    print(f"sent {len(lines)} query events over the last {args.minutes} min -> open /queries (Live)")


if __name__ == "__main__":
    main()
