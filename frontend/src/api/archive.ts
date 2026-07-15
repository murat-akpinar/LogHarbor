import { api } from './client'
import type { ArchiveSegment, ArchiveSettings, HydrationStatus } from '../types'

export function getArchiveSegments(): Promise<ArchiveSegment[]> {
  return api.get<ArchiveSegment[]>('/api/archive/segments')
}

export function startHydration(from: string, to: string): Promise<HydrationStatus> {
  return api.post<HydrationStatus>('/api/archive/hydrate', { from, to })
}

export function getHydrationStatus(from: string, to: string): Promise<HydrationStatus> {
  const query = new URLSearchParams({ from, to })
  return api.get<HydrationStatus>(`/api/archive/hydrate/status?${query.toString()}`)
}

export function getArchiveSettings(): Promise<ArchiveSettings> {
  return api.get<ArchiveSettings>('/api/settings/archive')
}

export function saveArchiveSettings(settings: ArchiveSettings): Promise<ArchiveSettings> {
  return api.put<ArchiveSettings>('/api/settings/archive', settings)
}
