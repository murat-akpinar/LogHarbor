import { api } from './client'
import type { Event, EventPage, ValidateResult } from '../types'

export interface EventQueryParams {
  filter?: string
  from?: string
  to?: string
  count?: number
  afterId?: number
}

function buildQuery(params: EventQueryParams): string {
  const search = new URLSearchParams()
  if (params.filter) search.set('filter', params.filter)
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.count) search.set('count', String(params.count))
  if (params.afterId !== undefined) search.set('afterId', String(params.afterId))
  const query = search.toString()
  return query ? `?${query}` : ''
}

export function getEvents(params: EventQueryParams): Promise<EventPage> {
  return api.get<EventPage>(`/api/events${buildQuery(params)}`)
}

export function getEvent(id: number): Promise<Event> {
  return api.get<Event>(`/api/events/${id}`)
}

export function validateFilter(filter: string): Promise<ValidateResult> {
  return api.post<ValidateResult>('/api/query/validate', { filter })
}

export interface SuggestParams {
  property?: string
  prefix: string
}

export function suggest({ property, prefix }: SuggestParams): Promise<{ suggestions: string[] }> {
  const search = new URLSearchParams({ prefix })
  if (property) search.set('property', property)
  return api.get(`/api/search/suggest?${search.toString()}`)
}

/** GET-able URL for a file download; the browser follows Content-Disposition, no fetch/blob needed. */
export function buildExportUrl(params: EventQueryParams & { format: 'json' | 'csv' }): string {
  const search = new URLSearchParams()
  if (params.filter) search.set('filter', params.filter)
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  search.set('format', params.format)
  return `/api/events/export?${search.toString()}`
}
