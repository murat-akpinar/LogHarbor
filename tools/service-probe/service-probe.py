#!/usr/bin/env python3
"""LogHarbor service probe: turns systemd unit / Docker container status into log events.

One CLEF batch per cycle, one event per configured service, all tagged Source="service-probe"
so status events stay out of normal search and histograms. `up` is 1 or 0; a probe that cannot
tell (systemctl missing, Docker daemon unreachable) emits an event with no `up` property at
all rather than a false 0 — the silence is the signal, and the dead man's switch reads it.

Usage:
  python3 service-probe.py                 # probe once, POST the batch (systemd timer)
  python3 service-probe.py --interval 60   # probe every 60 s until stopped (no systemd timer)
  python3 service-probe.py --dry-run       # print the batch, send nothing
  python3 service-probe.py --setup-alerts --webhook https://hooks.example/... [--window 5]
"""
import argparse
import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

URL = os.environ.get("LOGHARBOR_URL", "http://127.0.0.1:5000").rstrip("/")
API_KEY = os.environ.get("LOGHARBOR_API_KEY", "")
HOST = os.environ.get("PROBE_HOST", "") or socket.gethostname()
SERVICES = os.environ.get("SERVICES", "")
COMMAND_TIMEOUT = float(os.environ.get("PROBE_COMMAND_TIMEOUT", "10"))

SOURCE = "service-probe"
STATUS_TEMPLATE = "Service {service} is {state}"
FAILURE_TEMPLATE = "Service probe for {service} failed: {error}"


def iso(when):
    """CLEF @t: UTC ISO-8601 with milliseconds."""
    return when.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_targets(spec):
    """"systemd:nginx, docker:api, cron" -> [("systemd", "nginx"), ...]; bare names are systemd."""
    targets = []
    for entry in spec.split(","):
        entry = entry.strip()
        if not entry:
            continue
        kind, _, name = entry.rpartition(":")
        kind = (kind or "systemd").strip().lower()
        name = name.strip()
        if kind not in ("systemd", "docker"):
            raise ValueError(f"unknown service kind '{kind}' in '{entry}' (use systemd: or docker:)")
        # "systemd:" would otherwise probe `systemctl is-active ""` every cycle and report a
        # permanent failure for a service nobody configured
        if not name:
            raise ValueError(f"missing service name in '{entry}' (use systemd:NAME or docker:NAME)")
        targets.append((kind, name))
    return targets


def run_command(argv):
    """Run argv, returning (exit code, stdout, stderr). Raises OSError when the binary is missing."""
    result = subprocess.run(argv, capture_output=True, text=True, timeout=COMMAND_TIMEOUT)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def probe_systemd(name):
    """(state, up, extra) for a systemd unit. `systemctl is-active` exits non-zero when down,
    so only the printed state word is read; an unknown unit reads as inactive, same as stopped."""
    _, out, err = run_command(["systemctl", "is-active", name])
    state = out.splitlines()[0].strip() if out else ""
    if not state:
        raise ProbeError(err or "systemctl printed no state")
    return state, 1 if state == "active" else 0, {}


def probe_docker(name):
    """(state, up, extra) for a Docker container. A removed container is genuinely down; a
    daemon we cannot reach is not an answer, so that becomes a probe failure instead."""
    code, out, err = run_command(
        ["docker", "inspect", "--format", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}", name]
    )
    if code != 0:
        if "no such object" in err.lower():
            return "missing", 0, {}
        raise ProbeError(err.splitlines()[0] if err else f"docker inspect exited {code}")
    state, _, health = out.partition("|")
    extra = {"health": health} if health else {}
    return state, 1 if state == "running" else 0, extra


class ProbeError(Exception):
    """The probe could not determine the state — deliberately not the same as "down"."""


PROBES = {"systemd": probe_systemd, "docker": probe_docker}


def build_event(kind, name, timestamp):
    """One CLEF event for one service. Probe-specific keys are lowercase so they never collide
    with the PascalCase properties the UI groups on (`Service` feeds the /services page)."""
    event = {
        "@t": timestamp,
        "@mt": STATUS_TEMPLATE,
        "Source": SOURCE,
        "host": HOST,
        "kind": kind,
        "service": name,
    }
    try:
        state, up, extra = PROBES[kind](name)
    except (ProbeError, OSError, subprocess.SubprocessError) as error:
        message = str(error) or error.__class__.__name__
        return {**event, "@l": "Warning", "@mt": FAILURE_TEMPLATE, "error": message}
    return {**event, "@l": "Information" if up else "Warning", "up": up, "state": state, **extra}


def probe_all(targets):
    now = iso(datetime.now(timezone.utc))
    return [build_event(kind, name, now) for kind, name in targets]


def post_events(events):
    """POST the batch as newline-delimited CLEF; raise unless the server answers 201."""
    body = "\n".join(json.dumps(event) for event in events).encode("utf-8")
    request = urllib.request.Request(
        f"{URL}/api/events/raw",
        data=body,
        method="POST",
        headers={"Content-Type": "application/vnd.serilog.clef", "X-LogHarbor-ApiKey": API_KEY},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 201:
            raise RuntimeError(f"HTTP {response.status}")


def summarize(events):
    """One line per cycle for the journal: nginx=1 docker=0 logharbor=? ."""
    return " ".join(f"{event['service']}={event.get('up', '?')}" for event in events)


def run_once(targets):
    events = probe_all(targets)
    post_events(events)
    print(f"sent {len(events)} status events: {summarize(events)}", flush=True)


def run_loop(targets, interval):
    """Probe forever. Ingest failures back off but never stop the loop: a probe that exits is
    indistinguishable from a dead host, and the alerting cannot tell you which one it was."""
    backoff = 1.0
    while True:
        started = time.monotonic()
        try:
            run_once(targets)
            backoff = 1.0
        except (urllib.error.URLError, RuntimeError, OSError) as error:
            print(f"ingest failed: {error}; retry in {backoff:.0f}s", file=sys.stderr, flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60.0)
            continue
        time.sleep(max(0.0, interval - (time.monotonic() - started)))


# --- alert setup ------------------------------------------------------------------------------

def quote(value):
    """Query-language string literal: single quotes, embedded quote doubled."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def admin_session():
    """Log in as admin and return an opener carrying the session cookie."""
    user = os.environ.get("LOGHARBOR_ADMIN_USER", "")
    password = os.environ.get("LOGHARBOR_ADMIN_PASS", "")
    if not user or not password:
        sys.exit("set LOGHARBOR_ADMIN_USER and LOGHARBOR_ADMIN_PASS (see .env.example)")
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    api_call(opener, "POST", "/api/auth/login", {"username": user, "password": password})
    return opener


def api_call(opener, method, path, payload=None):
    """One management API call; returns the parsed JSON body or None for an empty response."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{URL}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {})
    try:
        with opener.open(request, timeout=15) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        # ProblemDetails says why (bad password, invalid filter, duplicate title) — a
        # traceback would bury it
        sys.exit(f"{method} {path} failed: HTTP {error.code} "
                 f"{error.read().decode('utf-8', 'replace')[:300]}")
    return json.loads(body) if body else None


def ensure_signal(opener, signals, title, filter_text):
    """Return the id of the signal with this title, creating it when it does not exist.

    Records what it created in `signals`: without that, the same title asked for twice in one
    run POSTs a duplicate, the API rejects it, and api_call exits with the host half configured.
    """
    signal_id = signals.get(title)
    if signal_id is not None:
        print(f"signal exists:  {title}")
        return signal_id
    signal_id = api_call(opener, "POST", "/api/signals",
                         {"title": title, "filter": filter_text})["id"]
    signals[title] = signal_id
    print(f"signal created: {title}  [{filter_text}]")
    return signal_id


def service_labels(targets):
    """Display name per target. A bare name where it is unambiguous, "name (kind)" only when
    the same name is configured under both kinds — so an existing install keeps its titles and
    re-running this stays idempotent, while systemd:redis and docker:redis stop colliding."""
    seen = {}
    for kind, name in targets:
        seen.setdefault(name, set()).add(kind)
    return {(kind, name): (f"{name} ({kind})" if len(seen[name]) > 1 else name)
            for kind, name in targets}


def setup_alerts(targets, webhook, window_minutes, payload_format):
    """Per service: a signal for reading, a heartbeat signal, and a silence alert rule.
    Everything is reused by title, so re-running this is safe.

    The rule fires when the service's up=1 heartbeat stops for `window_minutes` — which covers
    the service dying, the probe dying and the whole host dying, with no new alert logic."""
    opener = admin_session()
    signals = {signal["title"]: signal["id"] for signal in api_call(opener, "GET", "/api/signals")}
    alerts = {alert["title"] for alert in api_call(opener, "GET", "/api/alerts")}
    labels = service_labels(targets)

    # Every service reporting anything but a healthy up=1 — the one to toggle when you want
    # to know what is wrong across the whole host.
    ensure_signal(opener, signals, f"{HOST} service down or unknown",
                  f"Source = {quote(SOURCE)} and host = {quote(HOST)} "
                  "and (up = 0 or not Has(up))")

    for kind, name in targets:
        label = labels[(kind, name)]
        # the filter always pins the kind, whether or not the title needs to
        service_filter = (f"Source = {quote(SOURCE)} and host = {quote(HOST)} "
                          f"and kind = {quote(kind)} and service = {quote(name)}")
        # Two signals per service, because they answer different questions. The plain one is
        # the human view: every status the service reported, so a stop and the restart after
        # it sit in one timeline. The heartbeat one is plumbing for the alert below — it
        # matches up=1 only, which is exactly what has to fall silent for the rule to fire.
        ensure_signal(opener, signals, f"{HOST} {label}", service_filter)
        signal_id = ensure_signal(opener, signals, f"{HOST} {label} heartbeat",
                                  f"{service_filter} and up = 1")

        alert_title = f"{HOST} {label} down"

        if alert_title in alerts:
            print(f"alert exists:   {alert_title}")
            continue
        api_call(opener, "POST", "/api/alerts", {
            "title": alert_title,
            "signalId": signal_id,
            "condition": "silence",
            "thresholdCount": 0,
            "windowMinutes": window_minutes,
            "webhookUrl": webhook,
            "payloadFormat": payload_format,
            "isEnabled": True,
        })
        print(f"alert created:  {alert_title}  (silent for {window_minutes} min -> webhook, "
              f"{kind})")


# --- entry point ------------------------------------------------------------------------------

def positive_seconds(value):
    """`--interval 0` is falsy, so it used to fall through to a single probe and exit — which,
    for this tool, is indistinguishable from a dead host to the silence alert it installs."""
    seconds = float(value)
    if seconds <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return seconds


def main():
    parser = argparse.ArgumentParser(description="Emit systemd/Docker service status as LogHarbor events.")
    parser.add_argument("--dry-run", action="store_true", help="print the batch instead of sending it")
    parser.add_argument("--interval", type=positive_seconds, metavar="SECONDS",
                        help="probe repeatedly instead of once (use without a systemd timer)")
    parser.add_argument("--setup-alerts", action="store_true",
                        help="create the up signal and the silence alert rule per service, then exit")
    parser.add_argument("--webhook", help="webhook URL for --setup-alerts")
    parser.add_argument("--window", type=int, default=5, metavar="MIN",
                        help="silence window in minutes for --setup-alerts (default 5)")
    parser.add_argument("--format", default="generic", choices=("generic", "slack", "discord"),
                        help="webhook payload format for --setup-alerts (default generic)")
    args = parser.parse_args()

    try:
        targets = parse_targets(SERVICES)
    except ValueError as error:
        sys.exit(str(error))
    if not targets:
        sys.exit("set SERVICES, e.g. SERVICES=systemd:nginx,docker:api (see .env.example)")

    if args.setup_alerts:
        if not args.webhook:
            sys.exit("--setup-alerts needs --webhook")
        setup_alerts(targets, args.webhook, args.window, args.format)
        return

    if args.dry_run:
        print(f"URL={URL}  host={HOST}  services={len(targets)}")
        for event in probe_all(targets):
            print(json.dumps(event))
        return

    if not API_KEY:
        sys.exit("set LOGHARBOR_API_KEY (see .env.example)")
    if args.interval is not None:
        print(f"probing {len(targets)} services every {args.interval:.0f}s -> {URL}", flush=True)
        try:
            run_loop(targets, args.interval)
        except KeyboardInterrupt:
            print("stopped", flush=True)
        return
    run_once(targets)


if __name__ == "__main__":
    main()
