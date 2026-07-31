/**
 * The three ways into LogHarbor, as the reader will paste them.
 *
 * Every snippet here was run against a live server on 2026-07-31 and the event it produces
 * read back, field by field — that is what the `arrives` list on each option is: a record of a
 * measurement, not a reading of the docs. Three of three doc recipes checked before this one
 * turned out to be broken as written, which is why the rule exists.
 *
 * Code is never translated. i18n covers the prose around it.
 */

export type SendOptionId = 'otel' | 'serilog' | 'http'

/** What a field does on arrival, so the two options can be compared line by line. */
export interface ArrivalFact {
  /** Key into t.send.fields — the field's name in the reader's language. */
  field: 'level' | 'message' | 'template' | 'properties' | 'traceId' | 'resource'
  /** Key into t.send.notes — what actually happens to it, measured. */
  note: string
}

export interface SendOption {
  id: SendOptionId
  /** Shown as the card's title. A product name, so not translated. */
  name: string
  language: (origin: string, key: string) => string
  snippet: (origin: string, key: string) => string
  arrives: ArrivalFact[]
}

/**
 * The placeholder that stands in for a token the reader has not minted in this session.
 *
 * A key's token is shown once, at creation, and stored only as a SHA-256 hash — so a page
 * listing existing keys can name them but can never fill one in. Saying so beats printing
 * something that looks like a key and is not.
 */
export const KEY_PLACEHOLDER = '<your-api-key>'

export const SEND_OPTIONS: SendOption[] = [
  {
    id: 'otel',
    name: 'OpenTelemetry',
    language: () => 'sh',
    // no code change at all: every OTel SDK reads these three
    snippet: (origin, key) =>
      [
        `OTEL_EXPORTER_OTLP_ENDPOINT=${origin}`,
        'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
        `OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=${key}`,
      ].join('\n'),
    arrives: [
      { field: 'level', note: 'levelOtel' },
      { field: 'message', note: 'messagePlain' },
      { field: 'template', note: 'templateOtel' },
      { field: 'properties', note: 'propertiesPlain' },
      { field: 'traceId', note: 'traceIdSpan' },
      { field: 'resource', note: 'resourceOtel' },
    ],
  },
  {
    id: 'serilog',
    name: 'Serilog',
    language: () => 'csharp',
    snippet: (origin, key) =>
      [
        '// dotnet add package Serilog.Sinks.Seq',
        'Log.Logger = new LoggerConfiguration()',
        `    .WriteTo.Seq("${origin}", apiKey: "${key}")`,
        '    .CreateLogger();',
        '',
        'Log.Error("Order {OrderId} failed for {Customer}", 123, "acme");',
        '',
        'Log.CloseAndFlush();   // batching sink: a short-lived process sends nothing without this',
      ].join('\n'),
    arrives: [
      { field: 'level', note: 'levelDirect' },
      { field: 'message', note: 'messagePlain' },
      { field: 'template', note: 'templateDirect' },
      { field: 'properties', note: 'propertiesPlain' },
      { field: 'traceId', note: 'traceIdActivity' },
      { field: 'resource', note: 'resourceEnrich' },
    ],
  },
  {
    id: 'http',
    name: 'HTTP (CLEF)',
    language: () => 'sh',
    snippet: (origin, key) =>
      [
        `curl -X POST "${origin}/api/events/raw" \\`,
        `  -H "X-LogHarbor-ApiKey: ${key}" \\`,
        '  -H "Content-Type: application/vnd.serilog.clef" \\',
        `  --data-binary '{"@t":"${new Date().toISOString()}","@l":"Error",`,
        `     "@mt":"Order {OrderId} failed for {Customer}","OrderId":123,"Customer":"acme"}'`,
      ].join('\n'),
    arrives: [
      { field: 'level', note: 'levelDirect' },
      { field: 'message', note: 'messageRendered' },
      { field: 'template', note: 'templateDirect' },
      { field: 'properties', note: 'propertiesPlain' },
      { field: 'traceId', note: 'traceIdManual' },
      { field: 'resource', note: 'resourceManual' },
    ],
  },
]
