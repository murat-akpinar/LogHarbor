-- 013: events_cache gets the index events has had since 001.
-- Stats aggregates union the hot table with the hydrated cache and group or filter by level;
-- the cache side had only timestamp and segment_day indexes, so it was scanned. That became
-- the common path once histogram and summary started reading hydrated data at all.

CREATE INDEX ix_events_cache_level ON events_cache(level, timestamp);
