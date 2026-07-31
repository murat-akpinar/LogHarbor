# LogHarbor Frontend

React 18 + TypeScript + Vite + Tailwind CSS. SPA served by the backend in production.

--- PAGES ---

/            Dashboard (home): a sectioned monitoring overview — a glance band of stat
             tiles, Activity (one timeline: volume, duration and requests as three
             lanes of a single time axis), Analysis (top errors, exceptions, slowest
             ops), Services & users, and an hour-of-day heatmap; a Live toggle
             auto-refreshes a rolling last-hour window. (/dashboard is an alias of /.)
/events      Events page: search bar (with autocomplete), level filter chips, event
             list, live tail toggle, export (JSON/CSV)
/requests    Operations RED table as its own lens (events/min, error %, p95 Elapsed,
             trend sparkline; sortable columns); rows deep-link to filtered Events
/exceptions  Live exception feed (type, count, trend, first/last seen) with an
             inline context panel per row (latest occurrence + same-trace events)
/queries     DB query lens, split master-detail: left a sortable table (calls,
             total, avg, p95 per SQL text), right the selected query's detail
             (full SQL, stat tiles, connection, trend, recent occurrences,
             Events deep link); property names configurable (commandText/elapsed)
/services    Per-service RED table (event rate, error %, p95 Elapsed)
/users       Per-user activity (events, error %, last seen) for a chosen property
/analysis    Top errors (grouped by message template + level), top exception types,
             and operations slower than their own baseline; rows deep-link to
             filtered Events
/signals     List, create, edit, delete signals
/alerts      List, create, edit, delete alert rules (signal + threshold -> webhook)
/settings    API key management, archive/retention settings, backup download
             (admin only), user management (admin only), directory sign-in
             (LDAP, admin only), health status, sign out

The nav bar scrolls itself horizontally when eleven links do not fit; the page below
never scrolls sideways with it.
Nav order: Dashboard (home, /), Events, Requests, Exceptions, Queries, Services,
Users, Analysis, Signals, Alerts, Settings — every link carries a small inline
line icon (components/icons.tsx). (A grouped left sidebar shipped 2026-07-25 and
was reverted the same day by user preference — the classic top bar stays; the
lens pages it introduced remain.)

Auth is enabled automatically once at least one user account exists (LOGHARBOR_ADMIN_PASSWORD
seeds the first admin on startup) OR once directory sign-in is turned on — an LDAP-only install
has no local accounts, and counting them alone left the whole server open. While enabled, a
login screen gates the whole SPA until the session cookie is issued (GET /api/auth/status
drives this, and its ldapEnabled decides whether the login page's LDAP tab is usable).
The login card carries a Standard / LDAP segmented control; the choice is remembered in
localStorage, and a remembered LDAP choice falls back to Standard when the directory is
switched off. A directory user has no row in the users table, so the Users page lists local
accounts only (docs/ldap.md).
Viewers see every page but mutating controls (create/edit/delete forms, API key and
archive-setting changes) are hidden; the Users section under Settings is admin-only.

--- FOLDER STRUCTURE ---

frontend/src/
  api/          typed API client (fetch wrappers per resource: events.ts, signals.ts, ...)
  components/   reusable UI (EventRow, EventDetail, LevelBadge, SearchBar, TimeRangePicker)
  pages/        EventsPage, DashboardPage, RequestsPage, ExceptionsPage, AnalysisPage,
                SignalsPage, AlertsPage, SettingsPage
  hooks/        useLiveTail (SignalR), useEventSearch (React Query), useLiveRange
  i18n/         typed TR/EN dictionaries (en.ts source of truth, tr.ts typed as Messages) + LanguageProvider/useI18n
  lib/          formatting helpers (dates, levels, status classes, colors, suggestContext)
  types/        Event, Signal, AlertRule, User, ApiKey, shared DTO types

--- LANGUAGES ---

The UI ships in English and Turkish. Language is detected from the browser on
first load (navigator.language startswith 'tr' -> Turkish), and an explicit
choice via the NavBar TR/EN toggle is persisted to localStorage
('logharbor-lang') and wins thereafter. Dates and numbers format with the
active language (Intl APIs). Not translated: log event data, level names,
query-language syntax and operator labels, and backend API messages.
Dictionaries live in src/i18n/ (en.ts is the source; tr.ts is typed as
Messages = typeof en, so a missing key is a compile error).

--- EVENTS PAGE ---

Search bar: filter expression input, validate on submit via /api/query/validate
Autocomplete: while typing a bare property name or a value after =/<>/like, the
  bar debounces a call to /api/search/suggest and shows a dropdown (arrow keys +
  enter to accept, escape/blur to dismiss); parsing lives in lib/suggestContext.ts
Export: JSON/CSV links next to the time range picker build a GET /api/events/export
  URL from the current filter/range; the browser handles the download natively
  via the response's Content-Disposition header, no fetch/blob code needed
Level chips: quick toggles appended to the filter (@Level = 'Error'). They share the
  SeriesChip shape every legend on every other page uses (pill, hue dot, pressed
  state); they were bare words until 2026-07-31, which is what a label looks like,
  not a control. The dot takes the level's own hue, not the chart neutral — a chip
  that says "Information" names a level rather than drawing it.
Search history: last 10 committed filters (localStorage) shown as a dropdown when
  the bar is focused and empty; clicking one re-applies it without re-validation
Volume chart (2026-07-31): a Histogram over the page's OWN filter, in a well between
  the chips and the stream. The stream says what happened, the chart says when — and
  it carries the filter, so narrowing the search reshapes it, which is why it belongs
  here rather than being a second copy of the dashboard's. Clicking a bar narrows the
  range to it and dragging across bars zooms, the same two gestures the dashboard
  timeline answers to; both leave live mode, because a chosen slice contradicts it.
  It carries no legend: the level chips directly above it are already its colour key.
  With no range picked the window is the last 24 hours, anchored on the newest
  matching event when that is older than 24h — otherwise a server that stopped
  receiving on Friday draws an empty chart over a full list, which reads as a broken
  chart rather than as an idle server. Anchored on the search results and not the live
  tail, or in live mode the window would slide out from under the reader every few
  seconds. The block renders nothing when no bucket has anything in it.
Event list: virtualized, newest first, infinite scroll via afterId keyset paging.
  Full-bleed, alone among the pages: a stream is read by scanning it and has to fill
  the window, so it takes no section plate. ROW_HEIGHT is 32px (was 40 until
  2026-07-31, which spent a quarter of every screen on air).
Event row: timestamp, level badge (color-coded), rendered message
Custom columns: "Columns" picker adds event properties as extra list columns
  (localStorage, rendered client-side from each event's properties JSON)
Timestamps: toggle between absolute and relative ("2 min ago",
  Intl.RelativeTimeFormat, localStorage; relative view re-renders every 30s)
Keyboard shortcuts: / focuses search, j/k move the selection, Esc closes the
  detail panel, ? toggles a shortcut help overlay
Search term highlight: quoted free-text terms and contains values from the active
  filter are wrapped in <mark> (amber background) inside message and exception text;
  terms extracted client-side from the filter string, no backend involvement
Row click: expands EventDetail with a syntax-highlighted property tree (nested
  objects/arrays collapse via native details/summary; React text nodes only,
  log content is untrusted) + raw JSON
When the event carries a trace id, EventDetail shows it with a "View trace" button
  that replaces the search filter with @TraceId = '<id>' (all events of that request).
Trace timeline: when the filter is exactly @TraceId = '...' (what "View trace"
  applies), a waterfall panel renders above the list. When the trace has real spans
  (GET /api/traces/{id}, ingested via OTLP /v1/traces) it draws a real parent/child
  waterfall: rows nested by parent_span_id (orphans and cross-service parents treated
  as roots), bars from each span's actual start + duration, error-status spans tinted
  red, and the trace's log events overlaid as dots on the matching span (spanless ones
  on a trailing "(no span)" row). Clicking a span opens its detail (service, kind,
  status + message, attributes JSON); clicking a dot opens that event's detail.
  When the trace has NO spans (log-only senders), it falls back to a waterfall inferred
  from log timestamps: one row per span_id, bounds from the span's earliest/latest
  event (a lower bound on real duration), a dot per event. Both paths are pure frontend;
  a note appears when the log fetch (count=1000, newest first) is truncated.
Live tail: the shared Live control connects to /hubs/tail with the current filter (its dot
  carries the socket state: green connected, amber connecting, red dropped); new events prepend
  with a highlight
Time range: the picker beside it sets from/to and drops out of live, as everywhere else
Archived range: no notice on this page — the archived-day list and its Extract
  button live on the Settings page (search silently covers hot + hydrated data)
First-run onboarding: when the server has no events at all (empty result with no
  filter, level chips, signals or time range active), the list area shows a
  "send your first log" panel instead of an empty table — inline API key creation
  (admins; viewers are told to ask one), copy-paste curl / Serilog / OTel snippets
  with the origin and created key filled in, and a 5 s poll on the events query so
  the panel replaces itself with the list the moment the first event arrives

--- LIVE + TIME RANGE (EVERY TIME-RANGED PAGE) ---

One control group, top right of the page header, in the same place on Dashboard, Events,
Requests, Exceptions, Queries, Services, Users and Analysis: [Live] | [time range].
Both stay visible in both states — picking a range leaves live mode rather than making the
picker appear, so the row never shifts under the cursor.

components/LiveRangeControls.tsx composes it; hooks/useLiveRange.ts owns the state for the
stat pages. Nothing polls: `now` advances every 10 s while live, the range is part of every
query key, and React Query refetches because the key changed. Pages that are live by default
(Dashboard and the three lens pages) use a rolling last hour; Services, Users and Analysis
keep their 24 h window and start paused, so their default view is unchanged.
Events is the exception in kind, not in placement: its Live is a SignalR subscription rather
than a rolling window, so it keeps its own state and only borrows the control. It has no h1,
so the group sits at the right of the search-bar row — that row is the page's header.

--- SECTIONS AND WELLS ---

Every page is built from the same two pieces. A SectionBlock (components/ui/SectionBlock.tsx)
is the plate: a border, a small icon square, the section's name, an optional one-word fact
beside it (a count, "2 not up") and an optional pill linking to the page that holds the whole
of what it samples. A Panel (components/ui/Panel.tsx) is a well sunk into that plate — no
frame of its own, just a change of surface.

The frame belongs to the section and nowhere inside it. A page of individually framed cards
reads as a pile of boxes with nothing saying which belong together; a page of named sections
reads as answers. Dashboard, Requests, Services, Analysis and the settings tabs name their
sections; Users, Exceptions and Queries take the plate with no header, because repeating the
page's own h1 over its only table names nothing. Tables live in a well with
`overflow-x-auto`, charts in a padded well, and figures inside a well go one surface lighter
again (the query detail's tiles) rather than taking a border.

--- LEVEL COLORS ---

Colors come from theme tokens, not per-component Tailwind classes: --color-level-fatal,
--color-level-error, --color-level-warning, --color-level-information, --color-level-debug,
--color-level-verbose, defined once in src/index.css (see DESIGN TOKENS below) and consumed
via lib/levels.ts (LEVEL_TEXT for text, LEVEL_BAR for bars/badges, LEVEL_HEX for chart fills,
which can't read a CSS variable back).

Every level owns a hue, so severity is readable from color alone: Verbose violet, Debug cyan,
Information blue, Warning amber, Error red, Fatal a deeper rose so it still reads as worse
than Error next to it.

One palette, one meaning per hue, wherever a hue appears: blue reads, green creates, amber
changes, red destroys or fails. HTTP methods borrow the level hues on that rule (GET/HEAD blue,
POST the accent green, PUT/PATCH amber, DELETE red) rather than owning a palette of their own,
so a method beside a level chip is not a second colour language to learn.

Charts are the exception, and deliberately: LEVEL_CHART draws everything below Warning in one
neutral so color in a chart means trouble and nothing else. Method colors are never carried into
a chart - most events are not requests, and a red bar that might mean DELETE would stop meaning
failure, which is the only thing a chart color is there to say.
The low three are told apart by hue rather than by lightness. They were muted greys until
2026-07-25; distinguishing them at a glance beat keeping Information quiet.

--- SERIES COLORS (lib/series.ts) ---

Two chart rules run side by side, and they do not conflict because they apply to different
marks:

  BARS are neutral by default (LEVEL_CHART above). A histogram counts things; if every count
  had a hue, a busy hour and a broken hour would look equally loud.

  LINES are named. A lane holding an average and a p95 has to say which is which and two
  greys cannot, and a tile's sparkline has to say what it is the shape of. SERIES gives each
  measured series one hue it keeps everywhere it appears - the timeline lane, the tile
  sparkline and the chip all draw p95 in the same violet:
    SERIES.volume  green   how much arrived
    SERIES.avg     cyan    how long it took on average
    SERIES.p95     violet  how long the slow tail took
    SERIES.errors  red     how much failed

Two more helpers in the same file decide how a bar is *painted*, so every chart in the app is
drawn with one pen:

  barFill(color)  the colour at the cap fading to 58% of itself at the floor. A flat rectangle
                  was the last mark that still looked like a spreadsheet; the gradient reads as
                  light falling from above, the same direction the canvas is lit from, and it
                  is what makes a 4px column read as an object rather than a tick.
  barGlow(color)  the bloom under a bar, and ONLY for Warning and above (BarSegment.lit,
                  STATUS_SERIES.lit). In a healthy window nothing glows, so a bad hour is
                  findable from across the room. A chart where everything glows is a chart
                  where nothing does -- the Heatmap follows the same rule (cells below two
                  thirds of the peak get no bloom) and so does the service status board (only
                  down/unhealthy dots are lit).

A row sparkline takes the colour of what it counts: a route's, service's, user's or query's
traffic is volume green; an exception feed is errors red; an error template keeps its level's
chart colour. Colouring a route's whole traffic shape red because 6% of it failed was tried
and dropped on 2026-07-31 - the error % sits in the next column and says it with a number,
while the red shape only ever said "this row has some errors", which at a 10% error rate is
every row.

--- DASHBOARD PAGE ---

The home page (route /): a Nightwatch-style monitoring overview composed entirely
from the existing /api/stats/* endpoints (no dedicated endpoint), grouped into
labelled sections, each with a "view all" link to its full page.
Live toggle: a heartbeat control in the header. Live (default) polls every 10s over
a rolling last-hour window (React Query refetch as the window's end ticks;
keepPreviousData avoids skeleton flashes; pauses when the tab is backgrounded).
Pausing (or brushing a histogram) freezes on the current window and reveals the
TimeRangePicker for a static range; going live again resumes the rolling window.
Section "Activity" (-> Events): one chart, components/dashboard/ActivityTimeline.tsx.
Three lanes share a single time axis, a single hover and a single brush: EVENTS
(volume, stacked by severity — errors are the red part of the volume bars, not a
second chart), DURATION (avg and p95 as two lines on one scale) and REQUESTS
(1/2/3xx / 4xx / 5xx stacked, the class chips isolating one in the lane exactly as
they do on the Requests page). They were four cards with four axes until 2026-07-31,
which left the reader measuring across the page to line a latency spike up with the
errors that caused it. Each lane's chips are its colour key, its readout and its
control: clicking one isolates that series in its lane and rescales the lane to it
(forty errors under a thousand info lines are a flat smear until drawn against their
own maximum). Pointing at a column lights the same column in all three lanes and
opens one card with every lane's numbers for that instant, over the lane the pointer
is in. Clicking a column opens Events at that slice; dragging across columns
freezes+zooms all three lanes.
TIMELINE_BUCKETS is 120 with 1px gaps, twice the density of a chart in a half-width
card, because this one is as wide as the page. Bars are drawn against lib/plotScale
plotMax — the plain maximum plus a sliver, not a rounded one: no lane carries a
y-axis, so rounding 22 up to 50 would buy no readable number and spend half the plot
on air (the Events histogram and the Requests status chart use it for the same
reason). The duration lane is filled under its lines so it carries weight between two
sets of bars.
One TimeAxis under all three lanes, and the same component under the Events histogram
and the Requests status chart. Until 2026-07-31 those carried only the window's two
ends, on the argument that a reader can place a bar between them; at 120 columns over
an arbitrary window that is arithmetic nobody should be doing, and the owner asked for
ticks. Still no gridlines and still no y-axis — a rule up the plot would have to cross
the bars to reach the reader, and the bars are what is being read. lib/timeAxis picks
the step off a ladder (1m ... 28d) so a one-hour window ticks every ten minutes and a
fortnight ticks every two days, and the strip measures its own width to decide how
many labels fit, so the same chart is legible at 420px and at 1600px. Ticks land on
round LOCAL boundaries, not on multiples of the epoch: sub-day steps divide the day
evenly, so the two agree wherever the UTC offset is a whole number of hours and
disagree in India and Nepal. A tick on midnight (and every tick once the step is a day
or more) is labelled with its date instead of a clock time and set brighter, because
on a week-long window that is the only label saying where you are.
Every series is fetched at ActivityTimeline's TIMELINE_BUCKETS width so the lanes
land on the same columns; the error series is read out of the volume buckets rather
than queried again. The glance band above (StatTile x5: events, error rate, avg, p95,
active services) carries the headline figures and the comparison against the previous
window, so the chart repeats none of it.
A tile's shape is its floor, not an ornament: the sparkline is drawn full-bleed edge to
edge along the bottom of the tile in the series' own colour with the wash under it, so the
number sits over its own history rather than beside a thumbnail of it. TREND_HEIGHT and
TREND_CLEARANCE have to stay the same number -- the shape is absolutely positioned, so
nothing reflows around it and a floor taller than the padding runs under the delta. The
hairline along the top edge carries the same colour and is drawn even for a figure with no
shape (active services), so that tile still reads as part of the band. Queries' detail
tiles take the same treatment, which is why p95 is violet there too.
Section "Analysis" (-> Analysis): compact top-5 panels — top errors, top exceptions,
Routes (busiest operations by /api/stats/operations, message template + p95 latency)
and slowest operations. Error, route and slow-op rows deep-link to filtered Events;
exception rows don't (no @ExceptionType builtin). A route row the server folded
(operation.folded — the {id} in it is the server's, not the app's) deep-links with
`Path like '/api/orders/%'` instead of `=`, because no event carries the folded text;
lib/operations.ts builds both forms.
Section "Services & users": Service health (per-service error %, -> Services) and
Users (top UserId values by event count, -> Users); rows deep-link to filtered Events.
Heatmap: hour-of-day x day-of-week density grid (/api/stats/heatmap, UTC),
single-hue cells scaled by count, per-cell native title tooltip.
Empty state: with zero events in range, a card links to the Events onboarding.

--- SERVICES PAGE ---

Two sections: "Host services" (the probe board, below) and "Traffic", the per-service RED
table (/api/stats/services): event rate (events/min from
total over the selected range), error % (Error+Fatal share, tinted red when
non-zero), p95 Elapsed (em dash when the service carries no Elapsed), and a
24-bucket sparkline (/api/stats/histogram filtered to the service, red when
the service has errors). Service identity is service.name (OTLP) falling back
to Service (CLEF/Seq); events with neither stay off the page.
Row click: navigates to Events with (service.name = 'x' or Service = 'x')
and the range as from/to — the filter matches both spellings.

Above the table, the host status board (components/ServiceStatusBoard.tsx over
/api/stats/service-status): the host's own services (systemd units, Docker
containers) as tools/service-probe last reported them — one section per host,
one tile per service, worst first, each with a status dot, the raw state word
and the reading's age. Filled dot = the probe got an answer (up / down /
unhealthy), hollow = it did not (no heartbeat / unknown); the status word sits
next to it, so colour never carries the meaning alone. Tile click: Events
filtered to Source = 'service-probe' and that host + service. The board renders
nothing at all when no probe reported in the range, so an install without one
sees the page unchanged. Two service vocabularies share the page on purpose:
the table is what application services are doing, the board is whether host
services are alive (docs/service-status.md).

--- USERS PAGE ---

Per-user activity table (/api/stats/user-activity): groups events by one
user-identifying property (a text input picks it, default UserId) — total events,
error % (Error+Fatal share, tinted red when non-zero), last seen, and a
value-filtered sparkline. Events without the property stay off the page.
Row click: navigates to Events filtered by that user for the range. The filter is
numeric-aware — `UserId = 42` for numeric ids, `UserId = 'user-42'` for text — so
the deep link and sparkline match how the value is stored.

Detail panel (right side, on row click): level badge + relative timestamp
(absolute in the title), identity chips for the well-known properties
(Service/service.name, StatusCode, Method, Path, UserId, connection) that
filter the list on click, the message and exception with copy buttons plus the
exception's parsed source location (path:line), the trace section with "View
trace", per-property rows with filter/copy actions (nested values keep the
JSON tree), an "events around this" control that narrows the range to ±2
minutes, and the raw JSON collapsed behind a disclosure.

--- REQUESTS PAGE ---

Status-codes chart (top): stacked per-bucket histogram of events carrying a
StatusCode property, split into 1/2/3xx / 4xx / 5xx classes (three filtered
/api/stats/histogram calls; Information/Warning/Error level colors) with a
value axis, hour labels and a per-bucket hover tooltip; a hint replaces it
when no event carries StatusCode. The legend chips are toggles: pressing one
isolates that class — the chart drops the other series and the operations
table, its sparklines and its Events deep links all inherit the class filter
(StatusCode < 400 / >= 400 and < 500 / >= 500). Pressing it again restores all.
Live toggle: the page follows the dashboard's rolling last-hour auto-refresh
(pausing shows the TimeRangePicker) — same as Exceptions and Queries.

Operations RED table as its own lens (Nightwatch's "Requests" view):
/api/stats/operations (limit 50), per-operation RED grouped by route where
the events carry one and by message template otherwise — events/min, error %
(tinted red when non-zero), p95 Elapsed (em dash when the operation carries
no Elapsed) and a filtered sparkline. The route and method property names are
inputs on the page (Path/Method by default, RequestPath/RequestMethod under
Serilog's ASP.NET middleware, http.route under OTel); blank falls back to
template grouping. The numeric column headers re-sort the table client-side
(descending). Row click: navigates to Events with the range as from/to and
the filter the row was grouped on — the route and method properties, `like`
with % where the server folded ids out of the path, or @MessageTemplate for
a template group (lib/operations.ts).

--- EXCEPTIONS PAGE ---

Live exception feed: one row per exception group (type, count, trend
sparkline filtered by @Exception like 'Type%', first/last seen) from
/api/stats/top-exceptions over a rolling last-hour window refreshed every
10 s — the dashboard's Live toggle; pausing shows a static TimeRangePicker.
A narrative headline sums the groups ("152 exceptions in this range.").
Row click expands an inline context panel: the group's latest occurrence
(message + exception text, via /api/events with the same like-filter) and,
when that event carries a trace id, the same-trace events in time order
with the latest occurrence highlighted and a "View full trace" link to
Events filtered by @TraceId (which renders the trace waterfall).

--- ANALYSIS PAGE ---

Top errors table: /api/stats/top-errors grouped by (message template, level);
  a "new" badge marks groups that never occurred before the selected range
  (checked against a baseline top-errors query ending at the range start);
  each row shows a 24-bucket sparkline (/api/stats/histogram filtered to the
  row's template + level, colored by level)
Top exceptions table: /api/stats/top-exceptions grouped by exception type
Slower than usual table: /api/stats/slow-operations lists operation groups whose
  p95 of the Elapsed property in the range is >= factor x the group's own baseline
  p95 (its history before the range) — adaptive, no fixed threshold; columns are
  usual p95, now p95, x slower, count and a template-filtered sparkline. When the list is
  empty the card reads timedOperationCount/comparableOperationCount from the response to say
  which case it is: no event carries an Elapsed duration, no group has baseline history
  before the range to compare against (narrow the range), or nothing regressed.
Row click (errors and slow operations): navigates to Events with
  @MessageTemplate = '...' and the range as from/to; EventsPage reads the ?filter=
  deep link on mount

--- ALERTS PAGE ---

List, create, edit, delete alert rules: title, signal, threshold count, window
(minutes), webhook URL, payload format (generic / Slack / Discord), enabled toggle.
Shows last-fired time and last error inline.
Condition selector: "at least N events" (threshold) or "silent for N minutes" (dead
man's switch). Choosing silence hides the threshold field (sent as 0) and relabels the
window as the silence period; the rule row summary reads "fires when silent for Nmin".
Read-only for viewers (list only; the create form and edit/delete buttons are admin-only).

--- NOT FOUND ---

Unknown client routes render a "Page not found" view with a link back to Events
(the server serves index.html for any non-/api path — docs/api.md NOT FOUND —
so the SPA router owns the error state).

--- DESIGN TOKENS ---

src/index.css is the single source of truth for color, radius, shadow, motion and fonts.
Custom properties (--logharbor-*) hold the raw values; @theme maps them into the Tailwind
utility names components actually use (bg-surface, text-fg, text-level-error, rounded-card,
shadow-card, font-sans, font-mono, ...). Components name a role, never a raw palette color
(bg-slate-100, text-red-600, and so on) -- changing the palette means editing this one file,
nothing else. The only exception is lib/levels.ts's LEVEL_HEX map and lib/series.ts's
SERIES map, which name the same tokens for chart fills set as inline styles.

--- THEME: ONE, AND IT IS DARK ---

There is no theme switch. The light theme was cut on 2026-07-31 (owner's call) rather than
kept as a plainer twin: the palette is built out of translucent whites over a lit canvas,
and every one of those surfaces turns to mud on white. A theme that cannot carry the design
is not a second theme, it is a second design.

The canvas is not flat black. <html> paints three fixed radial washes (green key light top
left, indigo fill top right, a green floor glow) over a gradient, and body::after lays fractal
noise at 5.5% opacity on top -- that grain kills the banding a large gradient shows on 8-bit
displays and gives the glass something to sit on. Every translucent surface in the app is
transparent *to this*; drop the washes and the whole palette collapses to flat grey.

Surfaces are white at low alpha, and depth is alpha rather than lightness:
    surface        a plate, lifted off the canvas          rgb(255 255 255 / 0.06)
    surface-inset  a well, cut into a plate                rgb(0 0 0 / 0.3)
    surface-raised a selected row or an active tab         rgb(255 255 255 / 0.12)
    surface-float  a dropdown or popover, nearly opaque    rgb(17 22 24 / 0.92)
    surface-read   the event stream's flat bed             #0a0e10, opaque

The last two are where the glass deliberately stops. A menu you can read the page through is
a menu you cannot read; and ten thousand rows scrolling over a radial wash make every row a
slightly different colour from the one above it, which is exactly what a reading surface must
not do. Card / Panel / SectionBlock / NavBar apply the `.glass` class (backdrop-blur +
saturate) so one place decides how much the app sees through itself.

Card names which of those it is rather than taking a pile of booleans:
    plate   a free-standing object on the canvas (the default)
    lifted  the same bed, heavier shadow — the one card a screen is built around (login)
    float   surface-float + heavy shadow: tooltips and popovers
Every hover readout over a chart is `float`. They were `plate` until the owner reported on
2026-07-31 that the numbers were hard to read through them — the dropdowns had already been
moved to the opaque bed for exactly that reason and the chart readouts had been missed.

--- MOTION ---

Keyframes live in index.css and are entrance-only: a dashboard that re-animates while you are
reading it is a dashboard you stop reading.

    .animate-rise   a plate arriving, up and in. --delay staggers a row or a column of them
    .animate-grow   a bar growing out of the floor, with lib/plotScale sweep() giving each
                    column its share of a 380ms left-to-right sweep -- capped as a whole, so
                    a 120-column chart takes the same time to arrive as a 30-column one
    .animate-draw   a line drawing itself in. The path carries pathLength={1}, so one dash
                    covers the whole curve whatever its real length and nothing has to be
                    measured out of the DOM
    .animate-wash   the gradient under a line, fading in behind it

Charts key their columns by position, never by bucket timestamp: live mode moves the window
every ten seconds, and keying on the start would remount every bar and replay its entrance
over and over while somebody is reading it. Height changes are a CSS transition instead.
Every animation is disabled under prefers-reduced-motion.

--- STATE RULES ---

Server state: React Query (queries keyed by [resource, params])
UI state: useState/useReducer inside pages
Live tail buffer: capped at 500 events in memory, oldest dropped

--- DEV SETUP ---

Vite dev server proxies /api and /hubs to http://localhost:5000
npm run dev in frontend/, dotnet run in backend/ simultaneously
