import { api } from './client'
import type { HeatmapCell, Histogram, ServiceOverview, SlowOperation, StatsSummary, TopError, TopException } from '../types'

export interface StatsRangeParams {
  from: string
  to: string
  filter?: string
}

function buildQuery(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, string | number | undefined][]) {
    if (value !== undefined) search.set(key, String(value))
  }
  return `?${search.toString()}`
}

export function getHistogram(params: StatsRangeParams & { buckets: number }): Promise<Histogram> {
  return api.get<Histogram>(`/api/stats/histogram${buildQuery(params)}`)
}

export function getHeatmap(params: StatsRangeParams): Promise<{ cells: HeatmapCell[] }> {
  return api.get<{ cells: HeatmapCell[] }>(`/api/stats/heatmap${buildQuery(params)}`)
}

export function getSummary(params: StatsRangeParams): Promise<StatsSummary> {
  return api.get<StatsSummary>(`/api/stats/summary${buildQuery(params)}`)
}

export function getTopErrors(params: StatsRangeParams & { limit?: number }): Promise<{ errors: TopError[] }> {
  return api.get<{ errors: TopError[] }>(`/api/stats/top-errors${buildQuery(params)}`)
}

export function getTopExceptions(params: StatsRangeParams & { limit?: number }): Promise<{ exceptions: TopException[] }> {
  return api.get<{ exceptions: TopException[] }>(`/api/stats/top-exceptions${buildQuery(params)}`)
}

export function getServices(params: StatsRangeParams & { limit?: number }): Promise<{ services: ServiceOverview[] }> {
  return api.get<{ services: ServiceOverview[] }>(`/api/stats/services${buildQuery(params)}`)
}

export function getSlowOperations(
  params: StatsRangeParams & { property?: string; minSamples?: number; floorMs?: number; factor?: number; limit?: number },
): Promise<{ operations: SlowOperation[] }> {
  return api.get<{ operations: SlowOperation[] }>(`/api/stats/slow-operations${buildQuery(params)}`)
}
