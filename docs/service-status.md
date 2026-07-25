# Service Status (Up/Down)

Answering "is nginx up?" for infrastructure services (systemd units, Docker containers)
without adding an uptime subsystem to LogHarbor: a host-side probe turns the answer into
ordinary log events, and the existing dead man's switch turns silence into a webhook.

--- HOW IT WORKS ---

[systemctl is-active] \
                       -> [service-probe, once a minute] -> CLEF -> [/api/events/raw]
[docker inspect]      /                                                     |
                                                                            v
                                        [signal: up = 1] -> [silence alert] -> webhook

The probe is `tools/service-probe/` — a single Python file plus a systemd timer, installed
per host. LogHarbor itself gained no new endpoint, no new table and no new alert type; a
status event is just an event.

--- WHY NOT LOG RECENCY ---

The obvious approach — "a service is up if it logged in the last N minutes" — was rejected as
the primary signal. An up-but-idle daemon reads as down, and a service that logs nothing at all
(most of them) can never read as up. Recency is a fine fallback for a chatty application; it is
the wrong source of truth for infrastructure.

The probe answers directly instead: `systemctl is-active nginx` / `docker inspect api`. Both
are cheap, both are already installed on the host, and both mean exactly what they say.

--- EVENT SCHEMA ---

One event per service per cycle:

  {"@t":"2026-07-25T09:16:24.354Z","@l":"Information","@mt":"Service {service} is {state}",
   "Source":"service-probe","host":"web-1","kind":"docker","service":"api","up":1,
   "state":"running","health":"healthy"}

  Source   always "service-probe" — the tag that keeps status events out of normal work
  host     which machine answered (PROBE_HOST, default the hostname)
  kind     "systemd" or "docker"
  service  unit or container name
  up       1 or 0 — absent when the probe could not tell (see below)
  state    the raw word: active / inactive / failed / running / exited / missing / ...
  health   Docker healthcheck status, only when the container declares one

Property names are lowercase on purpose. The /services page groups on `service.name` or
`Service`; a lowercase `service` therefore never merges status events into the RED metrics of
a real application service. The message template is fixed, so every status event of every host
is one group in Analysis.

`@l` is Information when up and Warning when down — never Error. A stopped service must not
inflate the dashboard error count or the top-errors list; alerting is the alert rule's job.

Unknown is not down: when `systemctl`/`docker` is missing, the Docker daemon is unreachable, or
the command times out, the probe emits a failure event with **no `up` property**:

  {"@t":"...","@l":"Warning","@mt":"Service probe for {service} failed: {error}",
   "Source":"service-probe","host":"web-1","kind":"docker","service":"api",
   "error":"Cannot connect to the Docker daemon at unix:///var/run/docker.sock."}

The `up = 1` heartbeat stops either way, so the dead man's switch still fires; the difference is
that the reason is sitting in the log next to it instead of being invented as a false zero. A
container that has been removed is a real down (`state: "missing"`, `up: 0`), not a failure.

--- ALERTING ---

Reuse, do not reinvent: the alert rule is the `silence` condition shipped in Phase 14.

  signal  <host> <service> up
          Source = 'service-probe' and host = 'web-1' and service = 'nginx' and up = 1
  alert   <host> <service> down
          condition silence, window 5 min -> webhook

One rule covers three failures at once: the service died, the probe died, the host died. The
silence rule only fires after it has seen proof of life since the rule was created, so it never
alarms on a service that was never up (docs/api.md ALERTS).

`tools/service-probe/service-probe.py --setup-alerts --webhook <url>` creates that pair for
every configured service, reusing anything that already exists by title.

Immediate alerting is possible too, as a normal `at-least` rule over
`Source = 'service-probe' and service = 'nginx' and up = 0`: it fires on the first down cycle
instead of waiting out a window, but it cannot see a dead host — nothing sends `up = 0` when the
whole machine is gone. Running both is reasonable.

Two more useful filters:

  Source = 'service-probe' and up = 0            every service currently reporting down
  Source = 'service-probe' and health = 'unhealthy'   running but failing its healthcheck

--- KEEPING STATUS OUT OF THE WAY ---

Status events are ordinary events: they count toward the histogram, retention and archiving.
At one cycle a minute they cost `60 * 24 * <services>` events a day — about 7k/day for five
services. Exclude them from a search with:

  Source <> 'service-probe'

There is no delete-events API, so that tag is also the only cleanup handle after a test run.

--- WHAT IS NOT BUILT (YET) ---

There is no status board page and no `/api/stats/service-status` endpoint. The board is Phase 2
of this feature and only earns its place if the log-and-alert path is not enough in practice —
todo.md keeps it open. Until then the status lives in Events (filter above), the alert webhook,
and a saved signal per service.

HTTP/TCP endpoint checks ("is the site answering?") are deliberately out of scope: that is an
uptime product, and this feature exists to describe the host's own services, not the internet.
