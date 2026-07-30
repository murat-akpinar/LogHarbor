import { api } from './client'
import type {
  ApiKey,
  AuthStatus,
  CreatedApiKey,
  Health,
  LdapSettings,
  LdapTestResult,
  LoginMethod,
  UserRole,
} from '../types'

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
  method: LoginMethod = 'standard',
): Promise<{ authenticated: boolean; username: string; role: UserRole; mustChangePassword: boolean }> {
  return api.post('/api/auth/login', { username, password, method })
}

export function getLdapSettings(): Promise<LdapSettings> {
  return api.get<LdapSettings>('/api/settings/ldap')
}

export function saveLdapSettings(settings: LdapSettings): Promise<LdapSettings> {
  return api.put<LdapSettings>('/api/settings/ldap', settings)
}

/**
 * Asks the directory what it would say about these credentials, without creating a session.
 * Sends the settings on screen rather than the saved ones, so the button can be pressed while
 * still filling the card in.
 */
export function testLdap(
  username: string,
  password: string,
  settings: LdapSettings,
): Promise<LdapTestResult> {
  return api.post<LdapTestResult>('/api/settings/ldap/test', { username, password, settings })
}

export function logout(): Promise<void> {
  return api.post<void>('/api/auth/logout', {})
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return api.post<void>('/api/auth/password', { currentPassword, newPassword })
}
