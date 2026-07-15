import { api } from './client'
import type { User, UserRole } from '../types'

export interface CreateUserRequest {
  username: string
  password: string
  role: UserRole
}

export function getUsers(): Promise<User[]> {
  return api.get<User[]>('/api/users')
}

export function createUser(request: CreateUserRequest): Promise<User> {
  return api.post<User>('/api/users', request)
}

export function deleteUser(id: number): Promise<void> {
  return api.delete<void>(`/api/users/${id}`)
}
