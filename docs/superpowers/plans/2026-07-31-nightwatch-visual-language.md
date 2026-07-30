# Nightwatch visual language, page by page

Asked for 2026-07-31. Source material, all of it in `UI/`:

* `nightwatch.png` — Laravel Nightwatch's own dashboard. The reference.
* `timeline.png`, `routes.png`, `details.png` — Nightwatch marketing crops: request
  waterfall, the routes card, the log list.
* `summary.png`, `summary2.png`, `request.png`, `request2.png`, `loginpage.png` —
  Atlas Monitor, the owner's other app, which borrowed from Nightwatch and adds a
  few things Nightwatch does not have (a real y-axis, a delta line under each figure).

Where the two disagree, Nightwatch wins: it is the thing being asked for. The two
places Atlas is kept are called out below.

This is a visual pass. No new metric, no new instrumentation, no new endpoint —
every number on every screen below is one we already compute. The horizontal
`NavBar` stays; the reference's left sidebar is not being ported.

Nightwatch is dark-only ("Don't be afraid of the dark"). LogHarbor ships light and
dark, and the light theme is ours to design: same structure, same shapes, surfaces
inverted, series colours re-picked for contrast on white. Every colour comes from a
token in `frontend/src/index.css`, never a hex in a component.

---

## Part 1 — The shared language

Nine decisions. Everything after this is applying them.

### 1. Neutral by default, colour only for trouble

The single most characteristic thing in `nightwatch.png`: the request bars are
**grey**. Amber and red appear only where 4xx and 5xx are. A healthy day is a grey
skyline, and a bad hour is visible from across the room.

We colour every level today (`Histogram.tsx`, `LEVEL_HEX`). Change to:

* Verbose / Debug / Information → one neutral (`--color-chart-neutral`, new)
* Warning → amber, Error / Fatal → red

The level colours stay exactly as they are everywhere they name a level (chips, the
tooltip's legend, the events list). This is about the *bars*.

### 2. The metric header block

Replaces both the stat tile and the chart legend, and it is the shape the whole
dashboard is built from:

```
REQUESTS                          ▪ 1/2/3XX   ▪ 4XX   ▪ 5XX
124.2K                                 122K     126     324
--------------------------------------------------------------
  ▁▃▂▅█▂▁▃  (bars)
02 Nov 18:00:00 UTC              03 Nov 18:00:00 UTC
```

Tiny uppercase label, big light-weight number under it, and on the right one column
per series: a coloured square, its uppercase name, its own big number. The legend
*is* the readout — that is why Nightwatch needs no separate tiles.

Kept from Atlas: the `↑ 44.1% vs previous period` line. It is a real LogHarbor
capability (`StatTile` already computes it against the previous window) and Nightwatch
has nothing like it. It goes under the left-hand figure.

### 3. No axes, no gridlines — endpoints instead

Nightwatch draws no y-axis and no gridlines at all. Under the plot, two small mono
timestamps: window start bottom-left, window end bottom-right. Atlas added a y-axis
with ticks; do not follow it. Exact numbers are already one hover away in our
tooltip, and the axis is what makes our charts look like a spreadsheet.

`Histogram.tsx` loses its `niceMax`/`0` column and its per-bucket x labels.

### 4. Mono is for data, sans is for chrome

Timestamps, paths, durations, IDs, SQL, hosts, counts inside tables → mono. Labels,
headings, prose → sans. Already half-true in the codebase; make it a rule so the
detail pages read like the reference.

### 5. Section blocks

A section is an outer card. Its header is a small rounded icon square, the section
name in normal-weight sans, and a ghost pill on the far right that links onward:

```
┌ ▣  Activity                                          [ Requests ↗ ] ┐
│  ┌───────────────────────┐  ┌───────────────────────┐               │
│  │ metric header + chart │  │ metric header + chart │               │
└──└───────────────────────┘──└───────────────────────┘───────────────┘
```

### 6. Editorial cards

Some cards open with a sentence instead of a number — "152 exceptions reported in
24hrs." over "Errors have impacted 4,241 users." — then the chart, then a legend
line (`▪ 128 HANDLED  ▪ 88 UNHANDLED`), then a `View` pill bottom-right. Use for
things a count alone does not explain.

### 7. Dotted-leader key/value lists

From `request2.png`, for every detail panel:

```
DATE ...................................... 09 Jul 19:37:38
STATUS CODE ............................... 500
QUERIES ................................. 8  [View]
```

Uppercase label, dotted leader filling the gap, mono value right-aligned, optional
pill. Two columns side by side on wide screens.

### 8. Chips

Small, uppercase, mono, tinted background at ~12% of the hue, no border: HTTP
methods (`GET|HEAD` blue, `POST` green, `DELETE` red), status codes, log levels,
`UNHANDLED`. One chip component, one place to change them.

### 9. Severity marks in tables

Not whole coloured rows. A count that matters gets a mark: amber warning triangle
before a 4xx figure, a filled red pill around a 5xx figure, everything else plain.

**New tokens** (light + dark, in `index.css`): `--chart-neutral`, `--chart-line`,
`--chip-bg`, `--leader` (the dotted rule). Nothing else is added.

---

## Part 2 — Page by page

Ordered by how much each page changes, not by nav order. Every page keeps every
capability it has today.

### Dashboard — `DashboardPage.tsx`

The whole point of the exercise. Today: four `StatTile`s in a grid, then a stack of
panels. After: three section blocks.

**ACTIVITY** — two chart cards side by side, both in the metric-header shape:
* *Events*: total on the left with its delta; on the right the legend-as-stats for
  Information / Warning / Error, each with its own count. Neutral bars, amber and
  red segments (decision 1). Brush and click-through survive unchanged.
* *Ingestion lag*: the line-chart twin of it, avg and p95 as two thin lines. This is
  `IngestionLagStrip` promoted into a proper card.

**APPLICATION** — three cards:
* *Exceptions*, editorial (decision 6): "N exceptions in the last 24h", the sparkline
  under it, `View` → `/exceptions`. Fed by `useTopExceptions`.
* *Slow routes*, the `routes.png` card: method chip, mono path, `MAX 5,241ms` right
  in amber. Fed by `useSlowOperations`. `View` → `/requests`.
* *Service health*, the list from `summary2.png`: letter square, service name, error
  rate and p95 under it, status pill, per-row sparkline. Fed by `useServices`.

**Where the four figures go.** Total events and errors are absorbed into the Events
card's header. Services and ingestion lag keep their tiles, moved next to the
section they belong to — the band of four identical boxes across the top is what
makes the page look generic, and it is the first thing to go.

The ingest rejection banner stays exactly where and what it is.

### Requests — `RequestsPage.tsx`

`request.png` is almost this page already. Metric header block at the top (requests
total + 2xx/4xx/5xx as legend-stats; duration range + avg/p95), then the routes
table: `METHOD | PATH | 1/2/3XX | 4XX | 5XX | AVG | P95`, mono paths, method chips,
severity marks (decision 9), search box with a `⌘F` hint, and the filter pills
(`View all | Errors`, `Routes | Request`) wired to what we already filter by.

### Event detail — the flyout/panel behind `EventsPage.tsx`

From `request2.png`, and the biggest readability win after the dashboard:
breadcrumb, mono title with its chips, then the exception block (`UNHANDLED` chip,
exception type in mono, message large), then two dotted-leader panels — *Info*
(timestamp, level, service, host, trace id) and *Details* (properties). Long values
keep the existing expand.

### Events — `EventsPage.tsx`

`details.png`: one dense row per event — mono UTC timestamp, source chip, level
chip, message — and the property JSON expanding inline in a mono block underneath,
indented and syntax-tinted. Level filters become chips. The virtualised list and
live tail are untouched.

### Exceptions — `ExceptionsPage.tsx`

The `Recent Exceptions` list from `summary.png`: id chip + `EXCEPTION` chip, type in
mono, message under it, service under that, and on the right the occurrence count
big with a red sparkline beside it.

### Queries — `QueriesPage.tsx`

Requests' table language, applied: SQL truncated in mono, `CALLS | ERRORS | AVG |
P95 | LAST SEEN`, p95 in amber past the threshold.

### Services — `ServicesPage.tsx`

The service-health rows promoted to a full page: status pill, error rate, p95,
sparkline, last-seen. Up/down/stale keep their current meaning.

### Users, Analysis, Signals, Alerts

No structural change. They inherit the table, chip and card language from the shared
primitives, which is most of the work already done by the time they are reached.

### Settings — `SettingsPage.tsx`

Already its own item in `todo.md`. When it is done it should use section blocks
(decision 5) and dotted-leader lists (decision 7) for the health figures — the
tidy-up and the restyle are the same job on this page, so do them together.

### Login — `LoginGate.tsx`

`loginpage.png`: split screen, product line and a screenshot on the left, the
sign-in card on the right. The card keeps its method tabs — local and directory
sign-in both stay — and the LDAP tab still only appears when the server says so.

---

## Part 3 — Order of work

1. **Tokens and primitives first.** `--chart-neutral` and friends in `index.css` for
   both themes; then `Chip`, `MetricHeader`, `SectionBlock`, `KeyValueList` in
   `components/ui/`. Nothing visible ships in this step, and everything after it is
   assembly.
2. **`Histogram.tsx` and `Sparkline.tsx`.** Neutral-by-default bars, axes out,
   endpoint labels in, and a line variant for lag and duration. Every page that
   draws a chart changes with these two files.
3. **Dashboard.** The section blocks, using 1 and 2.
4. **Requests, then Queries, Exceptions, Services.** Same table language, in that
   order — Requests is the one with the reference screenshot to check against.
5. **Event detail, then Events.**
6. **Settings** (with its tidy-up item) **and Login.**

Each step is done when the frontend tests pass, the page reads in both themes, and
it has been seen at a narrow window. Steps 3 and 4 also get looked at on the test
server, signed in as a viewer as well as an admin, because half these panels are
admin-gated.
