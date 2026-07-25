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

  signal  <host> <service> heartbeat
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

Note what the heartbeat signal is for: it defines liveness, not a view of the service.
Toggled on the Events page it shows nothing but `is active` rows — an outage is exactly what
it filters out. So --setup-alerts saves reading signals next to it: `<host> <service>` (one
service's whole timeline, stops and restarts in order) and `<host> service down or unknown`
(everything on the host that is not a healthy heartbeat). The filters behind them:

  Source = 'service-probe' and service = 'cron'         one service's whole up/down timeline
  Source = 'service-probe' and (up = 0 or not Has(up))  down, plus "probe cannot tell"
  Source = 'service-probe' and health = 'unhealthy'     running but failing its healthcheck

--- KEEPING STATUS OUT OF THE WAY ---

Status events are ordinary events: they count toward the histogram, retention and archiving.
At one cycle a minute they cost `60 * 24 * <services>` events a day — about 7k/day for five
services. Exclude them from a search with:

  Source <> 'service-probe'

There is no delete-events API, so that tag is also the only cleanup handle after a test run.

--- THE BOARD ---

The filter and the alert answer "show me the outage" and "tell me about it". The board answers
the third question — "is anything down right now?" — at a glance, at the top of `/services`:
one section per host, one tile per service, worst first.

It reads the same events, through `GET /api/stats/service-status` (docs/api.md): the newest
reading per (host, service), turned into a status against the **end of the selected range**, not
wall-clock now, so a historical range shows how things stood then.

  down       fresh reading with up = 0
  stale      last reading older than staleMinutes (default 5, four missed cycles)
  unhealthy  fresh, up = 1, health = "unhealthy" — running but failing its own healthcheck
  unknown    fresh reading with no `up` at all — the probe could not ask
  up         fresh, up = 1

Two of those are the schema's own distinctions carried through instead of flattened. `stale`
outranks whatever the reading said: an `up = 1` from an hour ago is not evidence that anything
is up — the same reasoning that rejected log recency above. And `unknown` is not `down`, because
the probe already tells the two apart and collapsing them here would invent a false zero.

A tile links to that service's whole timeline in Events. The board is not rendered at all when no
probe has reported in the range, so an install without one sees the page it always had. It reads
only events: still no endpoint that writes, no table, no alert type.

HTTP/TCP endpoint checks ("is the site answering?") are deliberately out of scope: that is an
uptime product, and this feature exists to describe the host's own services, not the internet.
