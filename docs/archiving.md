# LogHarbor Archiving & Compression

Tiered storage to prevent database bloat. Old events are compressed to disk
and transparently extracted on demand.

--- TIERS ---

Hot:      recent events in the main SQLite db, instantly queryable
Cold:     events older than CompressAfterDays, Brotli-compressed daily segments on disk
Hydrated: cold segments temporarily extracted into a cache table for reading

--- LIFECYCLE ---

[hot events] --after CompressAfterDays--> [daily .clef.br segment] --after RetentionDays--> deleted

MaxDatabaseBytes is the brake behind all three. They are time policies, and time is the wrong
unit for a disk: doubling the ingest rate fills the volume long before RetentionDays elapses,
and the configuration that was right last month is wrong this month. Over the ceiling, the
oldest days are dropped whatever their age — segment file, segment row and hot rows together —
until the file fits. It runs on the scheduler's HOURLY tick, not the daily one, because a
volume filling up cannot wait until tomorrow. 0 disables it, which is the default: a setting
that deletes history should not arrive unannounced.

Losing the oldest day is the better failure. Running out of disk was measured to stop every
write while the server still reported itself healthy (fix.md item 1).

--- WHERE THE FILE IS HEADING ---

The ceiling says when the server starts dropping days; on its own it does not say when that
will first happen, so the operator sets a number and waits to be surprised by it. The hourly
pass already measures the database length to decide on the cap, and now keeps the reading in
db_size_samples (one row per pass, kept 14 days, pruned on the daily tick).

GET /api/archive/forecast fits a least-squares line over the last 7 days of those readings and
reports bytes per day plus, when a ceiling is set, how many days of room are left. Settings
renders it as one line under the ceiling field.

A fit, not last-minus-first: the size cap and the daily archive pass both cut the file back, so
a window starting or ending next to one of those steps would report a slope the disk never had.
A flat or falling fit is reported as "steady" rather than as negative growth — the question is
when the disk runs out, and "never, at this rate" is the whole answer. Below four readings or
three hours it says it is still measuring instead of extrapolating from one point.

--- PICKING A CEILING ---

The default of 0 is about not surprising anyone, not about 0 being right. Set one.

Project the settled size first: growth per day (the forecast reports it) x days kept hot, plus
the compressed tail, which is that daily figure over the remaining retention divided by the
compression ratio the Settings page shows for this instance's own data. Then take several times
that as the ceiling and check it is comfortably under the free disk.

Worked example, the test instance on 2026-08-09: 25 MB/day, hot for 90 days -> ~2.3 GB, plus
275 days compressed at the ~30x measured here -> ~0.25 GB, so about 2.7 GB settled against 64 GB
of free disk. Ceiling set to 10 GB; the forecast then answered 396 days.

That last number is the check worth doing. 396 is *past* RetentionDays (365), which is what a
correctly sized ceiling looks like: retention still decides what goes in normal running, and the
ceiling only ever engages when something abnormal makes the file grow faster than the projection.
A ceiling the forecast says is reached in fewer days than RetentionDays is not a brake, it is the
retention policy — silently, and by size rather than by the number the operator set.

Segments are files, not rows. archive_segments stores a day's file name, event count and
status; the events themselves only exist inside the .br file on disk. That split is why
GET /api/admin/backup ships a zip of the database AND the archive directory — a database
restored on its own lists days it cannot produce, and the Settings page marks such a day
"file missing" rather than offering to extract it (docs/api.md).
                                                |
                                     user opens old range
                                                |
                                       [hydrated cache] --unused for HydrationKeepDays--> evicted

--- ARCHIVE JOB (BACKGROUND, DAILY) ---

1. Find full UTC days older than CompressAfterDays still in the events table
2. Per day: export rows as JSON lines (all columns INCLUDING original id),
   compress with Brotli -> data/archive/events-YYYY-MM-DD.jsonl.br
3. Verify segment (line count matches), then delete those rows from events + FTS;
   the segment insert and the row delete are one transaction that rolls back
   (keeping hot data and discarding the file) if the counts disagree
4. Record segment in archive_segments table (day, path, event_count, size_bytes)
5. Incremental vacuum reclaims db space

Original ids are preserved so keyset pagination (afterId) stays stable
across hot and hydrated data. Only rows up to the largest exported id are
deleted, so events that arrive mid-archive are never lost.

A day that already has a segment is never re-archived: events that arrive
late for such a day stay in the hot table (safe, slightly larger db) rather
than risk merging into a verified segment file. They are still subject to
retention, which deletes hot rows past the cutoff whether archiving is on or
off — otherwise a late arrival could never be archived and never be deleted,
and one backfill would strand its rows in the database permanently.

Scheduling: one background service runs eviction hourly and archive +
retention once per UTC day, including a pass at startup so frequently
restarted servers still archive. Segments stuck in 'hydrating' after a
crash are returned to cold at startup.

--- HYDRATION ---

Trigger: user extracts a day from the Settings page archive list, or POST
/api/archive/hydrate
1. Decompress requested segments
2. Bulk insert into events_cache table (same schema as events + segment_day column,
   original ids kept); events_cache has its own FTS table (events_cache_fts) so
   free-text search works over hydrated data too
3. Segment marked hydrated; searches over that range read events UNION events_cache
4. last_accessed_at updated on every query that touches the segment

Eviction job (hourly): delete events_cache rows whose segment has
last_accessed_at older than HydrationKeepDays; segment reverts to cold.

--- STORAGE TABLES ---

archive_segments:
  day               TEXT   'YYYY-MM-DD', primary key
  file_path         TEXT   file name inside the archive directory
  event_count       INTEGER
  size_bytes        INTEGER compressed file size
  uncompressed_bytes INTEGER exported JSONL size (for the compression-ratio stat)
  status            TEXT   cold | hydrating | hydrated
  hydrated_at       TEXT   nullable
  last_accessed_at  TEXT   nullable

events_cache: same columns as events, plus segment_day TEXT (FK to archive_segments)

settings: key TEXT primary key, value TEXT (JSON) — runtime-changeable settings;
the 'archive' key holds the values above and overrides appsettings.json defaults

--- CONFIGURATION (SETTINGS PAGE + appsettings.json) ---

LogHarbor:ArchivePath                 default: archive/ next to the database file
LogHarbor:Archive:CompressAfterDays   default 90   (0 = archiving disabled)
LogHarbor:Archive:HydrationKeepDays   default 1
LogHarbor:RetentionDays               default 365  (deletes archive segments AND hot events
                                                past the cutoff, archiving on or off, so
                                                retention means one thing everywhere and
                                                growth is always bounded. Must be >=
                                                CompressAfterDays: a shorter value would
                                                compress a day to a file and delete it on
                                                the same pass, and the Settings page
                                                rejects it)

--- API ---

GET  /api/archive/segments                200: [ segment ] (day, status, counts, sizes)
POST /api/archive/hydrate                 body { from, to }  202: hydration started
GET  /api/archive/hydrate/status?from&to  200: { segments: [ { day, status } ] }

--- SEARCH BEHAVIOR ---

Query range fully hot: normal search
Range touches cold segments: response includes "archivedDays" list; results cover
  hot + hydrated data only. The UI does not interrupt the search over it — extraction
  lives on the Settings page, next to the archive stats
Range touches hydrated segments: seamless, events_cache included via UNION

--- UI (SETTINGS PAGE) ---

Compress events older than: [90] days   (0 disables)
Keep extracted data for:    [1] day
Delete archives older than: [365] days
Archive stats: segment count, total compressed size, compression ratio
Archived days: one row per segment (day, events, size, status) with an Extract
  button on the cold ones (admins only); polls until the day is searchable, then
  refreshes the segment list and the event queries

--- WHY BROTLI ---

Built into .NET (System.IO.Compression), no external dependency
10-20x typical ratio on repetitive log text
