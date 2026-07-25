# Service Status Board (Phase 15, Phase 2)

Phase 1 made a host's services answerable: `tools/service-probe` emits one event per
service per minute and the dead man's switch turns silence into a webhook. What it did
not give is the glance — "is anything down right now?" costs a hand-written filter and
a read of the newest rows per service.

This adds that glance and nothing else: one read-only endpoint over events that already
exist, and a board at the top of `/services`. No new table, no new writer, no new alert
type. If the probe was never installed, the board does not appear.

## THE QUESTION IT ANSWERS

For every (host, service) the probe has reported in the selected range: what did it say
last, and is that answer still fresh?

## STATUS DERIVATION

The store returns the newest reading per (host, service). Status is derived from that
reading against the **end of the selected range** — not against wall-clock now, so a
historical range reads as "how it stood then" and stays deterministic in tests.

| status      | when                                              | means |
|-------------|---------------------------------------------------|-------|
| `down`      | fresh reading, `up = 0`                           | the probe asked and got a no |
| `stale`     | last reading older than `staleMinutes`            | heartbeat stopped: service, probe or host |
| `unhealthy` | fresh, `up = 1`, `health = 'unhealthy'`           | running but failing its own healthcheck |
| `unknown`   | fresh reading with **no** `up` property           | the probe could not tell (docs/service-status.md) |
| `up`        | fresh, `up = 1`                                   | |

Evaluated in that order, and the response is sorted in that order too — the board leads
with what is broken. Ties break on host, then service.

`stale` outranks the reading's own value on purpose: an `up = 1` from an hour ago is not
evidence that anything is up. This is the same reasoning that made log recency a rejected
signal in Phase 1 — old evidence is not evidence.

`unknown` is deliberately not `down`. The probe distinguishes "asked and got no" from
"could not ask"; collapsing them here would throw that away.

## API

    GET /api/stats/service-status?from&to[&filter][&source][&staleMinutes][&limit]

    source        default "service-probe" — the Source tag the probe stamps
    staleMinutes  default 5, 1..1440 — the probe cycle is a minute, so 5 is four misses
    limit         default 100, 1..100 — as every other stats endpoint

    { "staleMinutes": 5, "asOf": "2026-07-25T09:20:00.0000000Z",
      "services": [ { "host": "web-1", "kind": "docker", "service": "api",
                      "status": "down", "state": "exited", "health": null,
                      "lastSeen": "2026-07-25T09:19:24.354Z",
                      "secondsSinceLastSeen": 36 } ] }

Property names (`host`, `kind`, `service`, `up`, `state`, `health`) are fixed by the probe
schema and hardcoded — unlike the query/user lenses, there is nothing here a user chooses,
so there is no property-name validation surface to get wrong. `source` is a value, bound as
a SQL parameter.

Reads hot + hydrated data through the same `BuildStatsSourceAsync` as every stats query,
so an archived range still answers.

## UI

A board card above the existing RED table on `/services`, one section per host, one tile
per service: status dot, service name, kind, the raw `state` word, and how long ago the
reading is. A tile links to Events filtered to that service's whole timeline:

    Source = 'service-probe' and host = '<host>' and service = '<service>'

The card is hidden entirely when the response is empty, so an install without a probe sees
the page it has today. It shares the page's existing live + range control — no second clock.

Colours reuse the token roles: `accent` up, `level-error` down, `level-warning` stale and
unhealthy, `fg-subtle` unknown. No new tokens.

## WHY NOT A SEPARATE PAGE

The nav is already eleven items and the classic top nav is a settled decision (todo.md
Phase 16). "Services" is the honest home for both readings: the RED table is what
application services are doing, the board is whether host services are alive. One page,
two questions, no eleventh-plus-one link.
