import { api } from './client'
import type { AlertPayloadFormat, AlertRule } from '../types'

export interface AlertRequest {
  title: string
  signalId: number
  thresholdCount: number
  windowMinutes: number
  webhookUrl: string
  isEnabled: boolean
  payloadFormat: AlertPayloadFormat
}

export function getAlerts(): Promise<AlertRule[]> {
  return api.get<AlertRule[]>('/api/alerts')
}

export function createAlert(request: AlertRequest): Promise<AlertRule> {
  return api.post<AlertRule>('/api/alerts', request)
}

export function updateAlert(id: number, request: AlertRequest): Promise<AlertRule> {
  return api.put<AlertRule>(`/api/alerts/${id}`, request)
}

export function deleteAlert(id: number): Promise<void> {
  return api.delete<void>(`/api/alerts/${id}`)
}
