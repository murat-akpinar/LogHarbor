import { api } from './client'
import type { ApiKey, AuthStatus, CreatedApiKey, Health, UserRole } from '../types'

export function getApiKeys(): Promise<ApiKey[]> {
  return api.get<ApiKey[]>('/api/apikeys')
}

export function createApiKey(title: string): Promise<CreatedApiKey> {
  return api.post<CreatedApiKey>('/api/apikeys', { title })
}

export function revokeApiKey(id: number): Promise<void> {
  return api.delete<void>(`/api/apikeys/${id}`)
}

export function getHealth(): Promise<Health> {
  return api.get<Health>('/healthz')
}

export function getAuthStatus(): Promise<AuthStatus> {
  return api.get<AuthStatus>('/api/auth/status')
}

export function login(
  username: string,
  password: string,
): Promise<{ authenticated: boolean; username: string; role: UserRole; mustChangePassword: boolean }> {
  return api.post('/api/auth/login', { username, password })
}

export function logout(): Promise<void> {
  return api.post<void>('/api/auth/logout', {})
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return api.post<void>('/api/auth/password', { currentPassword, newPassword })
}
