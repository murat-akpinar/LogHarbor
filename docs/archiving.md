# LogHarbor Archiving & Compression

Tiered storage to prevent database bloat. Old events are compressed to disk
and transparently extracted on demand.

--- TIERS ---

Hot:      recent events in the main SQLite db, instantly queryable
Cold:     events older than CompressAfterDays, Brotli-compressed daily segments on disk
Hydrated: cold segments temporarily extracted into a cache table for reading

--- LIFECYCLE ---

[hot events] --after CompressAfterDays--> [daily .clef.br segment] --after RetentionDays--> deleted
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
than risk merging into a verified segment file.

Scheduling: one background service runs eviction hourly and archive +
retention once per UTC day, including a pass at startup so frequently
restarted servers still archive. Segments stuck in 'hydrating' after a
crash are returned to cold at startup.

--- HYDRATION ---

Trigger: user requests an archived time range (Events page shows an
"archived range, extract?" banner) or POST /api/archive/hydrate
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
LogHarbor:RetentionDays               default 365  (applies to archive segments; hot data
                                                is archived, not deleted — EXCEPT when
                                                archiving is disabled (CompressAfterDays=0):
                                                then retention deletes hot events directly,
                                                so disabling archiving never means
                                                unbounded database growth)

--- API ---

GET  /api/archive/segments                200: [ segment ] (day, status, counts, sizes)
POST /api/archive/hydrate                 body { from, to }  202: hydration started
GET  /api/archive/hydrate/status?from&to  200: { segments: [ { day, status } ] }

--- SEARCH BEHAVIOR ---

Query range fully hot: normal search
Range touches cold segments: response includes "archivedDays" list; UI shows
  banner with an Extract button; results cover hot + hydrated data only
Range touches hydrated segments: seamless, events_cache included via UNION

--- UI (SETTINGS PAGE) ---

Compress events older than: [90] days   (0 disables)
Keep extracted data for:    [1] day
Delete archives older than: [365] days
Archive stats: segment count, total compressed size, compression ratio

--- WHY BROTLI ---

Built into .NET (System.IO.Compression), no external dependency
10-20x typical ratio on repetitive log text
