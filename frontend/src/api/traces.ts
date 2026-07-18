import { api } from './client'
import type { SpanRecord } from '../types'

export function getTrace(traceId: string): Promise<{ spans: SpanRecord[] }> {
  return api.get<{ spans: SpanRecord[] }>(`/api/traces/${encodeURIComponent(traceId)}`)
}
