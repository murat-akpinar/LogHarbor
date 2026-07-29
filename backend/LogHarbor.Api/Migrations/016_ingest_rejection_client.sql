-- 016: who sent the rejected request (docs/data-model.md)
--
-- The banner could name the API key, which is enough when there is one. The worst case is the
-- one where there is not: an "unauthorized" bucket says a client is being turned away and
-- offers nothing to identify it by, because the request never authenticated. The socket
-- address and the user agent are the only handles left, so they are kept alongside the last
-- detail — display only, never an authorisation decision.

ALTER TABLE ingest_rejections ADD COLUMN last_client TEXT;
ALTER TABLE ingest_rejections ADD COLUMN last_user_agent TEXT;
