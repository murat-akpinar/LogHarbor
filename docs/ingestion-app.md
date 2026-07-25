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
both of Seq's body formats (CLEF and the {"Events":[...]} envelope — see RAW HTTP below;
the endpoint sniffs which one arrived, no header to set). LogHarbor also accepts Seq's
X-Seq-ApiKey header (ApiKeyMiddleware), so existing Seq sinks need only the URL and key
changed. They bring batching, retry and buffering for free, which is why this beats
hand-rolling an HTTP client.

Each snippet below was run against a live LogHarbor and the resulting event read back, and
run repeatedly — a sink that delivers once and drops the next four is the failure mode here,
not a clean error. All three produce the same row: level Error, template "Order {OrderId}
failed for {Customer}", OrderId and Customer as structured properties.

.NET (Serilog):

  dotnet add package Serilog.Sinks.Seq

  Log.Logger = new LoggerConfiguration()
      .WriteTo.Seq(Environment.GetEnvironmentVariable("LOGHARBOR_URL")!,
                   apiKey: Environment.GetEnvironmentVariable("LOGHARBOR_API_KEY"))
      .CreateLogger();

  Log.Error(ex, "Order {OrderId} failed for {Customer}", 123, "acme");

  Log.CloseAndFlush();   // batching sink: without this a short-lived process sends nothing

.NET (NLog): NLog.Targets.Seq, same serverUrl + apiKey settings. Not tested here — it
sends CLEF like Serilog, so it should need nothing special, but that is reasoning rather
than a verified run.

Python (seqlog):

  pip install seqlog

  import logging, os, seqlog

  seqlog.log_to_seq(server_url=os.environ["LOGHARBOR_URL"],
                    api_key=os.environ["LOGHARBOR_API_KEY"],
                    level=logging.INFO, batch_size=100, auto_flush_timeout=2)

  logger = logging.getLogger(__name__)
  logger.error("Order {OrderId} failed for {Customer}", OrderId=123, Customer="acme")

  Use a named logger, not the module-level logging.error(). log_to_seq() calls
  setLoggerClass, so only loggers created after it get seqlog's StructuredLogger; the root
  logger already exists by then and keeps the stock class, which rejects the property
  kwargs with "TypeError: _log() got an unexpected keyword argument 'OrderId'".

  A long-running service needs nothing else — the batch drains every auto_flush_timeout
  seconds on seqlog's own thread. A short-lived script does, and the obvious ways are the
  wrong ones. Measured against a live server, 0 of 3 runs delivered for each of:

    (nothing)                                    lost — process exits first
    logging.shutdown()                           lost
    handler.flush() alone                        lost

  logging.shutdown() is the trap: it flushes and then closes, and seqlog's close() tears
  down the HTTP session without waiting for the batch to go out — its own source carries
  the "TODO: Implement QueueConsumer.join() so we can wait" comment for exactly this. The
  flush is asynchronous, so the process simply has to outlive it:

    import time
    for handler in logging.getLogger().handlers:
        handler.flush()
    time.sleep(1)

  5 of 5 delivered. seqlog also fails silently — seqlog.set_callback_on_failure(fn) is the
  only way to see a rejected batch, and worth wiring up while you are testing.

  seqlog attaches MachineName, ProcessId, ThreadId, ThreadName and LoggerName to every
  event, which arrive as ordinary filterable properties.

Node (winston):

  npm install winston @datalust/winston-seq

  The package is ESM only: use import, not require, and mark the project as a module
  ("type": "module" in package.json, or a .mjs file). require() fails with
  ERR_REQUIRE_ESM.

  import winston from "winston";
  import { SeqTransport } from "@datalust/winston-seq";

  const seq = new SeqTransport({
    serverUrl: process.env.LOGHARBOR_URL,
    apiKey: process.env.LOGHARBOR_API_KEY,
    onError: (e) => console.error(e),   // logging must never throw into the app
  });
  const logger = winston.createLogger({ transports: [seq] });

  logger.error("Order {OrderId} failed for {Customer}", { OrderId: 123, Customer: "acme" });

  await seq.flush();   // as with Serilog, flush before a short-lived process exits

  Keep the transport in a variable: the flush is on the transport, and logger.close() does
  not drain it — a script that ends without await seq.flush() sends nothing.

The key is a secret: read it from the environment, never commit it (rules.md SECURITY).

--- SENDING DB QUERY LOGS (feeds the Queries page) ---

The /queries page groups events that carry a SQL-text property (default
commandText) plus a duration property (default elapsed).

EF Core + Serilog: allow the command events through and they arrive already
shaped like that:

  .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command",
                         LogEventLevel.Information)

Any other stack works too: log an event with a commandText string property and
an elapsed (ms) number property; add a connection property to fill the
Connection column. The property names are configurable on the page itself.

--- ANY OTHER LANGUAGE: RAW HTTP ---

The endpoint accepts both of Seq's wire formats and tells them apart from the body itself,
so Content-Type only has to be honest, not exact.

CLEF — prefer this for new code:

  POST /api/events/raw
    X-LogHarbor-ApiKey: <token>            (or X-Seq-ApiKey)
    Content-Type: application/vnd.serilog.clef
    Body: one CLEF JSON object per line, newline-delimited (NOT a JSON array)

  {"@t":"2026-07-14T09:12:03.123Z","@l":"Error","@mt":"Order {OrderId} failed","OrderId":123}
  {"@t":"2026-07-14T09:12:04.001Z","@mt":"User {UserId} logged in","UserId":7}

@t is required (ISO-8601). @l defaults to Information. @mt is the template, @m the
rendered message, @x the exception; every other key becomes a queryable property.
Full mapping and level aliases: docs/data-model.md.

Seq raw events — one JSON document, properties in their own bag:

  POST /api/events/raw
    X-Seq-ApiKey: <token>                  (or X-LogHarbor-ApiKey)
    Content-Type: application/json

  {"Events":[
    {"Timestamp":"2026-07-14T09:12:03.123Z","Level":"Error",
     "MessageTemplate":"Order {OrderId} failed","Properties":{"OrderId":123}}
  ]}

Timestamp is required, Level defaults to Information and goes through the same alias map,
MessageTemplate/Message/Exception mirror @mt/@m/@x, and everything in Properties becomes a
queryable property. Renderings and EventType are ignored. This is the format seqlog and
winston-seq send, which is why it exists; hand-written clients gain nothing from it.

Errors name the offending event in whichever format was sent: "line 2: ..." for CLEF,
"event 2: ..." for an Events envelope. Either way nothing in the batch is stored.

Smoke test:

  curl -X POST "$LOGHARBOR_URL/api/events/raw" \
    -H "X-LogHarbor-ApiKey: $LOGHARBOR_API_KEY" \
    -H "Content-Type: application/vnd.serilog.clef" \
    --data-binary "{\"@t\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"@l\":\"Error\",\"@mt\":\"Test from {Source}\",\"Source\":\"curl\"}"

  @t is stamped now on purpose: it is the event's own time and every time-ranged view is
  a window over it, so a fixed date pasted from here would be accepted with a 201 and then
  not show up on the Dashboard.

  201 accepted | 400 bad line (detail names the line) | 401 bad key
  413 over MaxBatchBytes/MaxEventBytes | 429 rate limited

Writing your own client: batch. One POST per log line spends a rate-limit slot each time
(LogHarbor:IngestRateLimitPerMinute, default 1200 per key), so buffer events and flush every
N events or every few seconds. Never let a failed POST throw into the calling code, and
drop or spill to disk when the buffer fills — an app must not stall because its log
server is down.
