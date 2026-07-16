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


if __name__ == "__main__":
    dry_run()
