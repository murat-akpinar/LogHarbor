import { api } from './client'
import type { Signal } from '../types'

export interface SignalRequest {
  title: string
  filter: string
}

export function getSignals(): Promise<Signal[]> {
  return api.get<Signal[]>('/api/signals')
}

export function createSignal(request: SignalRequest): Promise<Signal> {
  return api.post<Signal>('/api/signals', request)
}

export function updateSignal(id: number, request: SignalRequest): Promise<Signal> {
  return api.put<Signal>(`/api/signals/${id}`, request)
}

export function deleteSignal(id: number): Promise<void> {
  return api.delete<void>(`/api/signals/${id}`)
}
