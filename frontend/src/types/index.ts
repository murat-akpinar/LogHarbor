export type Level = 'Verbose' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Fatal'

export interface Event {
  id: number
  timestamp: string
  level: Level
  message: string
  messageTemplate: string | null
  properties: string | null
  exception: string | null
  ingestedAt: string
  /** W3C trace/span ids (lowercase hex), null when the event carries none. */
  traceId: string | null
  spanId: string | null
}

export interface EventPage {
  events: Event[]
  hasMore: boolean
  /** Cold (non-extracted) archive days the queried range touches. */
  archivedDays: string[]
}

export interface ValidateResult {
  valid: boolean
  error?: string
  position?: number
}

export interface Signal {
  id: number
  title: string
  filter: string
  createdAt: string
}

export interface HistogramBucket {
  start: string
  counts: Record<Level, number>
}

export interface Histogram {
  buckets: HistogramBucket[]
}

/** One (day-of-week, hour-of-day) density cell, both UTC; dayOfWeek 0 = Sunday. */
export interface HeatmapCell {
  dayOfWeek: number
  hour: number
  count: number
}

export interface StatsSummary {
  total: number
  byLevel: Record<Level, number>
}

/**
 * How far behind their own timestamps events arrived, in seconds. Skewed events (stamped ahead
 * of their arrival) are counted apart and left out of the percentiles.
 */
export interface IngestionLag {
  total: number
  lateCount: number
  skewedCount: number
  p50Seconds: number
  p95Seconds: number
  maxSeconds: number
  worstTimestamp: string | null
  worstIngestedAt: string | null
}

export interface IngestionLagResult {
  lateAfterSeconds: number
  lag: IngestionLag
}

export type RejectionReason =
  | 'unauthorized'
  | 'rate_limited'
  | 'invalid_payload'
  | 'too_large'
  | 'unsupported_media_type'
  /** The batch was valid and the server could not store it — a full disk or a read-only
   *  mount. The graver half: the client did nothing wrong. */
  | 'write_failed'

/** One (api key, reason, UTC day) bucket of turned-away ingestion requests.
 *  apiKeyTitle is null when the request carried no valid key. */
export interface IngestRejection {
  apiKeyId: number
  apiKeyTitle: string | null
  reason: RejectionReason
  day: string
  requestCount: number
  firstSeen: string
  lastSeen: string
  lastDetail: string | null
  /** Socket address of the last attempt, with the forwarded-for claim when there is one. */
  lastClient: string | null
  lastUserAgent: string | null
}

export interface IngestRejectionsResult {
  rejections: IngestRejection[]
  totalRequests: number
}

/** One error group: all events sharing a CLEF message template and level. */
export interface TopError {
  template: string
  level: Level
  count: number
  firstSeen: string
  lastSeen: string
}

/** One exception group, keyed by the first line of the exception text up to ':'. */
export interface TopException {
  type: string
  count: number
  firstSeen: string
  lastSeen: string
  /** "path:line" parsed from the latest occurrence's stack trace; null when no frame carries a file. */
  location: string | null
}

/** One DB-query group: events sharing a query-text property value. */
export interface QueryOverview {
  value: string
  connection: string | null
  calls: number
  errorCount: number
  totalMs: number | null
  avgMs: number | null
  p95Ms: number | null
  lastSeen: string
}

/** One operation group whose current-window p95 latency regressed past its own baseline p95. */
export interface SlowOperation {
  template: string
  baselineP95: number
  currentP95: number
  count: number
}

/** GET /api/stats/slow-operations response: the regressed groups plus why the list may be empty. */
export interface SlowOperationsResult {
  operations: SlowOperation[]
  timedOperationCount: number
  comparableOperationCount: number
}

/** RED numbers for one service; p95ElapsedMs is null when no event carried Elapsed. */
export interface ServiceOverview {
  service: string
  total: number
  errorCount: number
  p95ElapsedMs: number | null
}

/** How the host probe last reported one service; the status is derived server-side. */
export interface ServiceStatusRow {
  host: string
  kind: string | null
  service: string
  status: 'down' | 'stale' | 'unhealthy' | 'unknown' | 'up'
  state: string | null
  health: string | null
  lastSeen: string
  secondsSinceLastSeen: number
}

/** GET /api/stats/service-status response; asOf is the range end the statuses were judged against. */
export interface ServiceStatusBoard {
  staleMinutes: number
  asOf: string
  services: ServiceStatusRow[]
}

/** One time bucket of the latency series; both figures are null where nothing in it was timed. */
export interface LatencyBucket {
  start: string
  avgMs: number | null
  p95Ms: number | null
}

/** Latency across a range and over it. sampled counts the events that carried Elapsed, so
 *  "nothing is timed here" is tellable from "everything was quick". */
export interface LatencyOverview {
  avgMs: number | null
  p95Ms: number | null
  sampled: number
  buckets: LatencyBucket[]
}

/** RED numbers for one operation (CLEF message template); p95ElapsedMs is null when no event carried Elapsed. */
export interface OperationOverview {
  /** The group's identity: "GET /orders/{id}" for a route, the message template otherwise. */
  template: string
  total: number
  errorCount: number
  p95ElapsedMs: number | null
  /** The verb, when the events named one. A failure logged by an exception handler carries the
   *  path and the status and no verb, and still gets its route — so a row can have a route with
   *  no method. Both are null for template groups (jobs, probes). */
  method: string | null
  route: string | null
  /** The route holds {id} placeholders the server put there, so no event carries it literally. */
  folded: boolean
  /** Counts per bucket over the requested window, present only when trendBuckets was asked for.
   *  It comes down with the row so a table of them costs no requests of its own. */
  trend?: number[] | null
}

/** Property names whose values ingestion refuses to keep; empty means the feature is off. */
export interface RedactionSettings {
  properties: string[]
  enabled: boolean
}

/** How often one value of a structured property appears in the range. */
export interface PropertyValueCount {
  value: string
  count: number
}

/** Activity for one value of a user-identifying property: totals, Error+Fatal count and last-seen. */
export interface UserActivity {
  value: string
  total: number
  errorCount: number
  lastSeen: string
  /** Counts per bucket, present only when trendBuckets was asked for — see OperationOverview. */
  trend?: number[] | null
}

/** One OTLP span from GET /api/traces/{id}; parentSpanId null for a root span. */
export interface SpanRecord {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  kind: string
  service: string | null
  startTimestamp: string
  durationMs: number
  statusCode: string
  statusMessage: string | null
  attributes: string | null
}

export interface ApiKey {
  id: number
  title: string
  createdAt: string
  isActive: boolean
}

/** Only returned at creation; the raw token is never shown again. */
export interface CreatedApiKey extends Omit<ApiKey, 'isActive'> {
  token: string
}

export type UserRole = 'admin' | 'viewer'

export interface AuthStatus {
  authRequired: boolean
  authenticated: boolean
  username: string | null
  /**
   * Null when auth is on and nobody is signed in: the API reads the role off the session
   * claim, which does not exist yet. The type used to claim UserRole unconditionally, which
   * was simply untrue of the responses the login gate depends on.
   */
  role: UserRole | null
  /** Seeded admin/admin account: the API refuses everything until a new password is set. */
  mustChangePassword: boolean
  /** Whether an admin has configured a directory, so the login page knows to offer the choice. */
  ldapEnabled: boolean
}

/** How a sign-in is authenticated: the local user table, or the configured directory. */
export type LoginMethod = 'standard' | 'ldap'

/** Directory sign-in configuration. Holds no password: LogHarbor binds as the user signing in. */
export interface LdapSettings {
  enabled: boolean
  host: string
  port: number
  security: 'ldaps' | 'starttls' | 'none'
  baseDn: string
  /** Active Directory bind form: username@suffix. */
  upnSuffix: string
  /** Bind DN template with {0} for the username; anything that is not AD needs this. */
  userDnPattern: string
  adminGroup: string
  viewerGroup: string
  nestedGroups: boolean
  allowInvalidCertificate: boolean
}

/** What the Settings card's test button gets back: no session, just what the directory said. */
export interface LdapTestResult {
  bound: boolean
  succeeded: boolean
  role: UserRole | null
  groups: string[]
  detail: string | null
}

export interface User {
  /** Null for a directory sign-in: there is no local row to edit or delete. */
  id: number | null
  username: string
  role: UserRole
  /** Created, for a local account; first signed in, for a directory one. */
  createdAt: string
  lastLoginAt: string | null
  source: 'local' | 'ldap'
}

export type AlertPayloadFormat = 'generic' | 'slack' | 'discord'

export type AlertCondition = 'at-least' | 'silence'

export interface AlertRule {
  id: number
  title: string
  signalId: number
  thresholdCount: number
  windowMinutes: number
  webhookUrl: string
  isEnabled: boolean
  createdAt: string
  lastTriggeredAt: string | null
  lastError: string | null
  payloadFormat: AlertPayloadFormat
  condition: AlertCondition
}

export interface Health {
  status: string
  eventCount: number
  dbSizeBytes: number
}

export type SegmentStatus = 'cold' | 'hydrating' | 'hydrated'

export interface ArchiveSegment {
  day: string
  filePath: string
  eventCount: number
  sizeBytes: number
  uncompressedBytes: number
  status: SegmentStatus
  hydratedAt: string | null
  lastAccessedAt: string | null
  /** The segment row survived but its .br file did not — a database restored without its
   *  archive directory. The events it claims cannot be produced. */
  fileMissing: boolean
}

export interface ArchiveSettings {
  compressAfterDays: number
  hydrationKeepDays: number
  retentionDays: number
  /** Hard ceiling on the database file; 0 disables it. The other three are time policies,
   *  and time is the wrong unit for a disk that fills faster than it ages. */
  maxDatabaseBytes: number
}

export interface HydrationStatus {
  segments: { day: string; status: SegmentStatus }[]
}

export type StorageTrend = 'measuring' | 'steady' | 'growing' | 'at-ceiling'

/** Where the database file is heading, fitted over the sizes the hourly maintenance pass
 *  records. `dailyGrowthBytes` is null while there is too little history to claim a trend. */
export interface StorageForecast {
  databaseBytes: number
  maxDatabaseBytes: number
  sampleCount: number
  observedHours: number
  dailyGrowthBytes: number | null
  daysUntilFull: number | null
  oldestDay: string | null
  status: StorageTrend
}
