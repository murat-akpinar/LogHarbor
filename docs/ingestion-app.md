# Sending Events From Inside an App

The other way in is Docker log collection (docs/ingestion-docker.md), which needs no app
change but delivers plain text lines. Logging from inside the app delivers structured
properties: OrderId, StatusCode and Duration become filterable fields instead of text
buried in a message.

  docker route:  @m = "Order 123 failed for acme"        filter: "failed" (free text)
  app route:     @mt = "Order {OrderId} failed for {Customer}"
                 OrderId = 123, Customer = "acme"        filter: OrderId = 123
                 and every "Order {OrderId} failed" event groups as one error on the
                 Analysis page, no matter the OrderId

Both can run at the same time; they are independent sources.

--- SEQ SINKS WORK AS-IS ---

LogHarbor's ingestion endpoint is wire-compatible with Seq: same path (/api/events/raw),
same CLEF body. LogHarbor also accepts Seq's X-Seq-ApiKey header (ApiKeyMiddleware), so
existing Seq sinks need only the URL and key changed. They bring batching, retry and
buffering for free, which is why this beats hand-rolling an HTTP client.

.NET (Serilog):

  dotnet add package Serilog.Sinks.Seq

  Log.Logger = new LoggerConfiguration()
      .WriteTo.Seq(Environment.GetEnvironmentVariable("LOGHARBOR_URL")!,
                   apiKey: Environment.GetEnvironmentVariable("LOGHARBOR_API_KEY"))
      .CreateLogger();

  Log.Error(ex, "Order {OrderId} failed for {Customer}", 123, "acme");

.NET (NLog): NLog.Targets.Seq, same serverUrl + apiKey settings.

Python (seqlog):

  pip install seqlog

  seqlog.log_to_seq(server_url=os.environ["LOGHARBOR_URL"],
                    api_key=os.environ["LOGHARBOR_API_KEY"],
                    level=logging.INFO, batch_size=100, auto_flush_timeout=2)

  logging.error("Order {OrderId} failed for {Customer}", OrderId=123, Customer="acme")

Node (winston):

  npm install winston @datalust/winston-seq

  new SeqTransport({
    serverUrl: process.env.LOGHARBOR_URL,
    apiKey: process.env.LOGHARBOR_API_KEY,
    onError: (e) => console.error(e),   // logging must never throw into the app
  })

  logger.error("Order {OrderId} failed for {Customer}", { OrderId: 123, Customer: "acme" })

The key is a secret: read it from the environment, never commit it (rules.md SECURITY).

--- ANY OTHER LANGUAGE: RAW HTTP ---

  POST /api/events/raw
    X-LogHarbor-ApiKey: <token>            (or X-Seq-ApiKey)
    Content-Type: application/vnd.serilog.clef
    Body: one CLEF JSON object per line, newline-delimited (NOT a JSON array)

  {"@t":"2026-07-14T09:12:03.123Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}
  {"@t":"2026-07-14T09:12:04.001Z","@mt":"User {UserId} logged in","UserId":7}

@t is required (ISO-8601). @l defaults to Information. @mt is the template, @m the
rendered message, @x the exception; every other key becomes a queryable property.
Full mapping and level aliases: docs/data-model.md.

Smoke test:

  curl -X POST "$LOGHARBOR_URL/api/events/raw" \
    -H "X-LogHarbor-ApiKey: $LOGHARBOR_API_KEY" \
    -H "Content-Type: application/vnd.serilog.clef" \
    --data-binary '{"@t":"2026-07-14T09:12:03Z","@l":"Error","@mt":"Test from {Source}","Source":"curl"}'

  201 accepted | 400 bad line (detail names the line) | 401 bad key
  413 over MaxBatchBytes/MaxEventBytes | 429 rate limited

Writing your own client: batch. One POST per log line spends a rate-limit slot each time
(LogHarbor:IngestRateLimitPerMinute, default 1200 per key), so buffer events and flush every
N events or every few seconds. Never let a failed POST throw into the calling code, and
drop or spill to disk when the buffer fills — an app must not stall because its log
server is down.
