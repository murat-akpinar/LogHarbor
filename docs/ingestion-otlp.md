# Sending Events With OpenTelemetry (OTLP)

LogHarbor accepts the OpenTelemetry protocol for logs: OTLP/HTTP on the standard
/v1/logs path, in BOTH encodings (binary protobuf and JSON). Anything that speaks
OTLP — an OTel SDK in any language, an OTel Collector, or another forwarder —
ingests into LogHarbor without a Seq-compatible sink.

  POST /v1/logs
    X-LogHarbor-ApiKey: <token>          (same key as CLEF ingestion)
    Content-Type: application/x-protobuf | application/json

Not implemented: OTLP/gRPC (:4317) and the traces/metrics signals; POST /v1/traces
answers 404 so exporters fail fast instead of buffering forever.

--- SDK CONFIGURATION (ANY LANGUAGE) ---

OTel SDKs read these environment variables; no code change needed:

  OTEL_EXPORTER_OTLP_ENDPOINT=http://logharbor:5000
  OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
  OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<token>

(http/json also works where the SDK supports it. The key is a secret: environment
only, never committed — rules.md SECURITY.)

--- OTEL COLLECTOR ---

Already running a Collector? Add an exporter and put it in the logs pipeline:

  exporters:
    otlphttp/logharbor:
      endpoint: http://logharbor:5000
      headers:
        X-LogHarbor-ApiKey: ${env:LOGHARBOR_API_KEY}

  service:
    pipelines:
      logs:
        exporters: [otlphttp/logharbor]

--- MAPPING (LogRecord -> Event) ---

severity_number 1-24 -> the six canonical levels in blocks of four
  (1-4 Verbose, 5-8 Debug, 9-12 Information, 13-16 Warning, 17-20 Error,
  21-24 Fatal); missing number -> severity_text through the CLEF alias map
time_unix_nano -> timestamp (UTC fixed format, future clamp — same normalization
  as CLEF @t); 0 -> observed_time_unix_nano; both 0 -> server time
body            -> message (string bodies as-is, structured bodies as JSON text;
  empty/absent body falls back to the message_template text)
message_template.text attribute -> message_template (Serilog's OTel sink sends it;
  error grouping on the Analysis page works exactly like CLEF @mt)
trace_id/span_id -> lowercase hex into the trace columns (@TraceId/@SpanId filters)
attributes      -> properties; resource attributes (service.name, ...) merge in
  first, so a record attribute wins on key collision
exception.type/message/stacktrace attributes -> the exception column, composed as
  "{type}: {message}\n{stacktrace}" so exception grouping matches .NET text

Dotted attribute keys are first-class in filters: service.name = 'checkout-api'
(docs/query-language.md PROPERTY ACCESS).

--- RESPONSES ---

200 with ExportLogsServiceResponse (same encoding as the request)
  partial_success set when records were dropped (rejected_log_records +
  error_message) — today that means single records over MaxEventBytes
400 unparseable body | 401 bad key | 404 unknown /v1 path
413 over MaxBatchBytes | 415 unsupported content type | 429 rate limited

--- SMOKE TEST ---

  curl -X POST "$LOGHARBOR_URL/v1/logs" \
    -H "X-LogHarbor-ApiKey: $LOGHARBOR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"curl-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"0","severityNumber":9,"body":{"stringValue":"hello from OTLP"}}]}]}]}'

Expect {} back; the event appears in the UI with service.name = 'curl-test'.
