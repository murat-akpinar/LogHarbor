-- 014: ingest_rejections — why a client's events never arrived (docs/data-model.md)
--
-- A rejected ingestion request used to leave no trace at all: the client saw a 4xx and
-- dropped its events, the server logged nothing, and the only way to find out was a packet
-- capture. That is how a Seq sink sending an unsupported body format went unnoticed.
--
-- Aggregated per (api_key_id, reason, day), not one row per request: a misconfigured client
-- retries forever, and the record of the problem must not become the biggest table in the
-- database. api_key_id 0 means the request carried no valid key, so there is nothing to join.

CREATE TABLE ingest_rejections (
  id INTEGER PRIMARY KEY,
  api_key_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  day TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_detail TEXT
);

CREATE UNIQUE INDEX ix_ingest_rejections_key_reason_day
  ON ingest_rejections(api_key_id, reason, day);
