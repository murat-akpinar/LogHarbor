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

/** RED numbers for one operation (CLEF message template); p95ElapsedMs is null when no event carried Elapsed. */
export interface OperationOverview {
  template: string
  total: number
  errorCount: number
  p95ElapsedMs: number | null
}

/** Activity for one value of a user-identifying property: totals, Error+Fatal count and last-seen. */
export interface UserActivity {
  value: string
  total: number
  errorCount: number
  lastSeen: string
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
}

export interface User {
  id: number
  username: string
  role: UserRole
  createdAt: string
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
}

export interface ArchiveSettings {
  compressAfterDays: number
  hydrationKeepDays: number
  retentionDays: number
}

export interface HydrationStatus {
  segments: { day: string; status: SegmentStatus }[]
}
