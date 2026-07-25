# service-probe

Turns "is nginx running?" into log events, so LogHarbor can answer it without a new subsystem.
A systemd timer runs the probe once a minute; each cycle POSTs one CLEF event per service to
`/api/events/raw`, with `up` = 1 or 0. Alerting is the existing dead man's switch: a signal that
matches the `up = 1` heartbeat, and a `silence` alert rule that fires when the heartbeat stops.

Concept, event schema and alert patterns: [`docs/service-status.md`](../../docs/service-status.md).

## Install (systemd timer, the normal case)

On the host you want to watch — as root, because `docker inspect` needs the Docker socket:

```bash
mkdir -p /root/service-probe && cd /root/service-probe
# copy service-probe.py, .env.example and the two unit files here
cp .env.example .env && chmod 600 .env      # then fill LOGHARBOR_API_KEY and SERVICES
python3 service-probe.py --dry-run          # prints the events it would send, sends nothing

install -m 644 service-probe.service service-probe.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now service-probe.timer
journalctl -u service-probe.service -f      # one "sent N status events: ..." line per minute
```

Both units assume `/root/service-probe`; edit `WorkingDirectory` and the paths if you put it
elsewhere. Stop it with `systemctl disable --now service-probe.timer`.

No systemd on the host (a container, a Mac, a cron-only box)? Run the loop instead:
`python3 service-probe.py --interval 60`. It never exits on an ingest failure — it backs off and
retries, because a probe that dies looks exactly like a host that died.

## Configuration

All of it via `.env` (see `.env.example`); systemd reads the same file.

| Variable | Meaning |
|---|---|
| `LOGHARBOR_URL` | LogHarbor base URL (default `http://127.0.0.1:5000`) |
| `LOGHARBOR_API_KEY` | ingestion key — the only credential a probe cycle needs |
| `SERVICES` | comma-separated `kind:name`; a bare name means systemd |
| `PROBE_HOST` | value of the `host` property (default: the machine's hostname) |
| `PROBE_COMMAND_TIMEOUT` | seconds before a check counts as "cannot tell" (default 10) |
| `LOGHARBOR_ADMIN_USER` / `_PASS` | only `--setup-alerts` needs these |

`SERVICES=systemd:nginx,systemd:docker,docker:api,docker:redis`

- `systemd:<unit>` → `systemctl is-active <unit>`; up only when the state is exactly `active`.
- `docker:<container>` → `docker inspect <container>`; up only when the state is `running`.

## What it sends

One event per service per cycle, all tagged `Source = 'service-probe'`:

```json
{"@t":"2026-07-25T09:16:24.354Z","@l":"Information","@mt":"Service {service} is {state}",
 "Source":"service-probe","host":"web-1","kind":"docker","service":"api","up":1,
 "state":"running","health":"healthy"}
```

`@l` is `Information` when up and `Warning` when down — never `Error`, so a down service does not
distort the dashboard's error counts or the Analysis page's top errors. `health` appears only for
Docker containers that declare a healthcheck; it is reported, not folded into `up`, so an
unhealthy-but-running container stays `up = 1` and you can alert on `health` separately.

When the probe **cannot tell** — `systemctl`/`docker` missing, the Docker daemon unreachable, the
command timing out — it sends a failure event with **no `up` property at all** rather than a false
zero:

```json
{"@t":"...","@l":"Warning","@mt":"Service probe for {service} failed: {error}",
 "Source":"service-probe","host":"web-1","kind":"docker","service":"api",
 "error":"Cannot connect to the Docker daemon at unix:///var/run/docker.sock."}
```

The `up = 1` signal goes quiet, so the dead man's switch still fires — and the reason is in the
log next to it. A container that has been removed is different: that is a real down
(`state: "missing"`, `up: 0`).

## Alerts

```bash
set -a; . ./.env; set +a
python3 service-probe.py --setup-alerts --webhook https://hooks.slack.com/... --window 5 --format slack
```

Per configured service this creates (reusing anything that already exists, by title):

- signal **`<host> <service>`** — `Source = 'service-probe' and host = '<host>' and service = '<service>'`
  — every status the service reported, so a stop and the restart after it read as one timeline
- signal **`<host> <service> heartbeat`** — the same plus `and up = 1`; plumbing for the rule
  below, since a dead man's switch needs a filter that goes quiet when the service stops
- alert **`<host> <service> down`** — condition `silence`, window `--window` minutes

plus one host-wide signal, **`<host> service down or unknown`** —
`Source = 'service-probe' and host = '<host>' and (up = 0 or not Has(up))` — everything on the
host that is not a healthy heartbeat, including the events where the probe could not tell.

The rule fires when that heartbeat produces nothing for a whole window, which covers the service
dying, the probe dying, and the whole host dying — one mechanism, no new alert logic. It needs
admin credentials because signals and alert rules are behind the auth gate, and it re-fires once
per window while the service stays down (LogHarbor's alert cooldown).

Want the faster, noisier variant instead? A normal `at-least` rule over
`Source = 'service-probe' and service = 'api' and up = 0` fires on the first down cycle, but it
cannot see a dead host. Running both is a reasonable belt and braces.

## Caveats

- `systemctl is-active` prints `inactive` for a unit that does not exist, so a typo in `SERVICES`
  looks like a stopped service. `--dry-run` after editing `SERVICES` catches that.
- One probe watches one host. Point several at the same LogHarbor; they separate by `host`.
- Status events retain and archive like any other event; there is no delete-events API. They are
  excluded from a search with `Source <> 'service-probe'`.
