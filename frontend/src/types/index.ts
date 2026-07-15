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
}

/** One operation group whose current-window p95 latency regressed past its own baseline p95. */
export interface SlowOperation {
  template: string
  baselineP95: number
  currentP95: number
  count: number
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
  role: UserRole
  /** Seeded admin/admin account: the API refuses everything until a new password is set. */
  mustChangePassword: boolean
}

export interface User {
  id: number
  username: string
  role: UserRole
  createdAt: string
}

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
