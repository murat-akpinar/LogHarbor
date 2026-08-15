# Changelog

All notable changes to LogHarbor.

## Unreleased


### Changes

* Strip userinfo from a masked webhook, not just the path
* Add a repository map, so finding code is not a search each time
* Explain the number, not the label
* Give a directory session a deadline, since it is the only re-check there is
* Say which ceiling to pick, not just that there is one
* Get the dependency scans to zero, and prove the SQLite swap kept FTS5
* Stop the deploy script quietly filling the disk it deploys to
* Name the proxy, or one person's typo locks out everyone
* Measure the certificate setting from a process that was actually restarted
* Ask the filesystem whether the volume survived, not the health endpoint
* Answer a stranger with the verdict, not with the size of the install
* Give the browser a policy, since the product is other people's strings
* Stop handing a read-only account every webhook it could post to
* Stop asking the whole database what "usual" means
* Show the thing moving, since a still cannot show a shared crosshair
* Ask history for exception names, not for everything about them
* Run the four detectors at once, and let the band arrive rather than jump
* Stop a wide range's findings scan outrunning the tick that asks for it
* Give a finding the colour and the shape of what it measures
* Catch a slowdown that began inside the range you are looking at
* Let the server say what it noticed, without a rule for it
* Rebuild the committed SPA bundle for the own-filter form
* Let an alert rule carry its own filter
* Dim the alarming dashboard by desaturating it, not by fading it
* Let the dashboard show it is alarming
* Let an alarm be acknowledged
* Read the stack trace instead of printing it
* Let an operator name the property values this server will not keep
* Mark the exception types this range saw for the first time
* Stop the status chips claiming a zero they never counted
* Put a failed panel's message where its data would be
* Give every panel one loading, empty and failed state
* Break the status chart down by exact code
* Group a 4xx/5xx line as its route even without a verb
* Make the dashboard's glance band five plates, not five wells
* Take the coloured wash off the canvas behind the signed-in app
* Make the range presets a log reader's ladder, and drop the week
* Give the Events page one scrollbar, and the drawer the whole right side
* Let the live tail arrive where animations are switched off
* Let the entrances arrive where animations are switched off
* Open live, so a reload does not land on a still page
* Tell the two LDAP-over-TLS failures apart in the docs
* Show who has signed in, and when, directory users included
* Correct two things ldap.md promises that the server does not do
* Let the probe read the .env its own README tells you to write
* Say the filter operators in the reader's language
* Stop the page reading through a floating menu
* Draw the filter value suggestions ourselves
* Stop tests answering each other's questions
* Fix two documented things that do not survive being run
* Say why the volume lane is empty instead of drawing a hole
* Make a preset a rolling window the whole app agrees on
* Open on the last hour with the stream off, still rolling
* Stop an active signal from hiding the trace timeline
* Give @TraceId and @SpanId the "is set" screen @Exception already had
* Make the performance numbers re-runnable
* Keep the font licence inside the file that ships
* Ship 59 KB of font instead of 2.4 MB of unused icon glyphs
* Make a broken deploy fail loudly instead of serving the old container
* Ignore todo-archive.md, and restore the .vscode rule an append broke
* Make Live mean one thing on Events too
* Open live again, on the rolling hour the shared window was meant to be
* One time window for the app, and the Users trend off the row
* Make Fatal a colour Error is not: rose to magenta
* Put the status filters on the left, where Events keeps its level chips
* Review pass over the performance work: three fixes and the caching it missed
* Stop animating the charts: keep the colours, drop the motion
* Make the pages arrive when the data does, not a second later
* Revert the merged Activity lane: three lanes were right after all
* Draw duration over the volume bars: three lanes become two
* Give the send-logs page its README section, in both languages
* Pin the send-logs link to the nav, where it can actually be found
* Add a send-logs page, and stop losing OTel message templates
* Draw the layers in the trace waterfall
* Rebuild the detail drawer in the app's own language
* Give the charts a time axis, an opaque readout, and put one on Events
* Paint every bar with one pen, and make a tile's shape its floor
* Give the whole app one dark theme, made of glass and lit from behind
* Make the level filters look like the controls they are
* Give the remaining pages the same plates and wells
* Make the bars fill their lane, and every legend a control
* Fold Activity's four charts into one timeline
* Make the dashboard status chips filter, since that is what they look like
* Put the request timeline in Activity, and let it link through narrowed
* Quiet the event list stripes so the loud rows are findable
* Give every hue one meaning: blue reads, green creates, amber changes, red fails
* Bring back the glance band, with latency and a line on every tile
* Add a latency query: avg and p95 over a range and per bucket
* Draw the volume chart as a skyline, not as slabs
* Make a dashboard section one object instead of a pile of boxes
* Record what the visual-language plan got wrong
* Drop the Chip primitive that ended up with no callers
* Give settings one screen per question instead of six at once
* Say the verb apart from the route, and colour only what is wrong
* Keep Cascadia as the one interface face
* Lead the dashboard with its charts instead of a tile band
* Draw charts neutral by default and drop their axes
* Split the sans and mono faces and add the chart tokens
* Ui plan
* Update
* Say why the connection failed when the restart is still pending
* Document directory sign-in and route folding in the READMEs
* Remove the duplicate LDAP test directory
* Keep the test directory's scripts LF, and add the unrelated-group case
* Sanitise the username on the refusal log line
* Keep group memberships out of the log, and bound the LDAP username
* Update Dockerfile
* Update docker-compose.yml
* Do not set the certificate callback on Linux — it breaks the connection
* Reach libldap's TLS_REQCERT through libc, not the managed environment
* Make the untrusted-certificate setting work on Linux
* Sign in against a directory, with the role from group membership
* Add LDAP settings, stored in the database not a file
* Fold ids out of request paths before grouping operations
* Filter bölümünü kapatma aksiyonu iyileştirildi
* Update
* Update

### Documentation

* The localhost example was the exception, not the problem

### Features

* Ldap  test file
* Routes yapısı revize edildi
* Routes kısmı güncellendi
* UI geliştirmesi yapıldı, görsel iyileştirme yapıldı

### Fixes

* The Columns panel hung off the edge of the window
## 0.1.0 — 2026-07-26


### Changes

* Restore the classic top nav, Events right after Dashboard
* Path değişikliği

### Documentation

* Three README bugs that only running it could find
* How to upgrade, measured by upgrading
* The restore steps need a chown, or the server will not start
* Say which Seq sinks are verified, and how
* Stop claiming NLog was verified when it was not
* Seqlog drops the event unless the process outlives the flush
* The Python and Node sink snippets never worked
* Stamp the smoke test now, not eleven days ago
* The Vector recipe did not work as written
* What a deconfigured service looks like on the board
* A section per page, and how to actually use it
* Implementation plan for the Queries lens page and nav icons
* Design split master-detail Queries lens page and nav icons
* Implementation plan for sidebar nav and lens pages
* Visual-language addendum from Nightwatch reference screenshot
* Design Nightwatch-style sidebar nav + requests/exceptions lens pages
* Spec for Nightwatch-inspired live pulse dashboard
* README web-UI/pages section, refresh feature list
* Slow-operations empty states implementation plan
* Design slow-operations empty states
* OTLP traces ingestion implementation plan
* OTLP traces ingestion design spec
* Dead man's switch alerts implementation plan
* Dead man's switch alerts design spec
* Trace timeline implementation plan
* Trace timeline (waterfall from stored logs) design spec
* Services overview (APM-lite RED) design spec
* Self-telemetry (OTel metrics) design spec
* Fold load-char results into its README, index it in test/README
* Running-in-5-minutes walkthrough, linked from both READMEs
* Alert webhook presets design spec
* Swagger admin-gate design spec
* Backup endpoint design spec
* First-run onboarding panel design spec
* Sync identifier alphabet comments and OTLP body mapping
* Count OTLP as a third log ingestion route
* Document OTLP log ingestion
* Size plan Task 7 test payloads to the test factory caps
* Fix uncompilable raw-string syntax in plan Task 5 tests
* Add OTLP ingestion (Phase 12-B) implementation plan
* Match schema column order to migration 008 reality
* Plan trace correlation (phase 12-A)
* Index the test tooling
* Plan the traffic simulator implementation
* Design a continuous multi-service traffic simulator
* Implementation plan for anomaly test harness
* Relocate anomaly harness to test/anomaly-test, note seed-demo siblings
* Design spec for anomaly test harness
* Correct HTTP cookie note and add home/LAN testing steps
* Document TR/EN language support
* Add TR/EN i18n implementation plan
* Add TR/EN i18n design spec

### Features

* Turn the size ceiling into a date
* Say which migrations an upgrade applied
* A size ceiling for the database, because time is the wrong unit for a disk
* Record and surface rejected ingestion requests
* Accept Seq's Events envelope on /api/events/raw
* Phase 18 — ingestion lag, an App-level test, and a settings timeline
* Surface cold days instead of silently omitting them
* A status board for the host's own services
* Up/down per host service from the probe's own events
* One live + time range control, same corner, every page
* A hue per level, and a rule before the saved filters
* Save a host-wide down-or-unknown signal
* Host probe emits systemd/docker up-down events
* Isolate a status class from the chart; axis, labels, tooltip
* Richer detail panel — chips, per-property actions, source, look-around
* Db-query-sim backfill tool; seed-demo feeds the new lenses
* Status-class chart (1/2/3xx-4xx-5xx) and live toggle
* Source location (path:line) parsed from the latest trace
* Live rolling-window toggle like the exceptions feed
* EF-style query events; document /api/stats/queries and the Queries page
* Rich detail pane — trend, occurrences, Events link
* Split master-detail queries lens page
* Line icons on every top-nav link
* /api/stats/queries groups DB-query events with durations
* Chip-style section links; document sidebar and lens pages
* Inline trace-context panel on the exception feed
* Live exception feed page
* /requests lens page owns the operations RED table
* Grouped Nightwatch-style sidebar replaces the top nav
* Routes card (busiest operations + p95) in Analysis section
* Nightwatch-style sectioned overview as the home page
* Per-user activity page (Nightwatch user lens)
* Per-operation RED table (Nightwatch Requests view)
* Live Nightwatch-style pulse overview
* Four-state empty message on the slow-operations card
* Slow-operations reports timed and comparable counts
* Real span waterfall on the trace page
* Trace read endpoint and span retention
* POST /v1/traces ingestion endpoint
* Spans table and store
* Vendor trace protos and map OTLP spans
* Condition selector for dead man's switch rules
* Silence condition evaluation (dead man's switch)
* Persist and validate a rule condition field
* Page-not-found view for unknown client routes
* Show trace timeline panel on Events page
* TracePanel span waterfall component
* Span grouping and trace-filter detection helpers
* Ingest request duration histogram per source
* Per-service RED overview endpoint and Services page
* Self-telemetry - OTel metrics behind OTEL_EXPORTER_OTLP_ENDPOINT
* Per-rule webhook payload presets for Slack and Discord
* Serve Swagger in every environment behind the admin session
* Admin-only backup endpoint with consistent SQLite snapshot
* First-run onboarding panel on the empty Events page
* Add OTLP/HTTP log ingestion at /v1/logs
* Allow dotted property identifiers in filters
* Parse OTLP/JSON with hex trace id transcoding
* Map OTLP log records to events
* Convert OTLP AnyValue trees to JSON
* Vendor OTLP protos (v1.10.0) with build-time codegen
* Show trace ids in EventDetail with View trace filter
* Expose trace ids in events API and CSV export
* Add @TraceId and @SpanId query builtins
* Parse CLEF @tr/@sp into trace_id/span_id
* Carry trace_id/span_id through Event and all stores
* Add trace_id/span_id columns (migration 008)
* Translate settings page
* Translate signals and alerts pages
* Translate dashboard and analysis pages
* Translate search, filter editor and time range picker
* Translate events page, list, detail and archive banner
* Translate login and password-change screens
* Add language toggle to NavBar and wrap app in LanguageProvider
* Accept a locale in formatTimestamp and formatRelative
* Add typed TR/EN i18n dictionaries and LanguageProvider
* Font eklendi

### Fixes

* The size cap deleted every day instead of the oldest ones
* A disk that fills while idle must not report healthy
* The health probe passed on a full disk; use recorded failures too
* Health check said ok while the server was losing every batch
* The backup silently omitted the archived history
* The 5-minute quickstart's own curl misses the dashboard it promises
* Keep --setup-alerts idempotent across versions
* P2 robustness batch across tail, archive, export and the probe
* Close four independent correctness gaps in auth, ingest and tail
* Accept negative and signed number literals
* Retention deletes hot events whether archiving is on or off
* Histogram and summary read the hydrated archive cache
* Put Live and the range picker in the page's top right
* Seed-demo timestamp comparison; accept an existing -ApiKey
* Offer trace/span id fields in the filter chip editor
* Force LF for load-char scripts so git archive ships sh-parseable files
* Validate CLEF @tr/@sp ids and close 12-B review follow-ups
* Apply time range presets on Analysis and Dashboard

### Maintenance

* Ignore last.md scratch notes
* Rebuild bundled SPA with TR/EN translations

### Refactoring

* Collapse the duplicated code the last bugs hid in
* Move day extraction from Events to Settings
* Share level aliases and future clamp for OTLP

### Tests

* Cover the hydrate segment cap
* Load characterization results - write-path refactor not urgent
* Load characterization driver and server-side monitor
* Traffic-sim systemd unit and README
* Traffic-sim sending loop with backoff
* Traffic-sim event shapes and diurnal rate curve
* Record anomaly harness run results and LogHarbor findings
* Fix template defaulting, check stdin, and container webhook delivery
* Anomaly-sim check + setup-alert (auth, signal, alert)
* Webhook listener for anomaly alert delivery
* Anomaly-sim sender core (seed-baseline, tick, reset)
* Scaffold anomaly harness (config template, README, ignores)

