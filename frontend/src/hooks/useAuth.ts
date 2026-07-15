import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changePassword, getAuthStatus, login, logout } from '../api/settings'

const AUTH_KEY = ['auth', 'status']

export function useAuthStatus() {
  return useQuery({ queryKey: AUTH_KEY, queryFn: getAuthStatus, retry: false })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) => login(username, password),
    // a fresh session changes what every other query may read
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      changePassword(currentPassword, newPassword),
    // clears mustChangePassword, which is what the rest of the app is gated on
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/** Viewers are read-only; while auth status is still loading, assume admin to avoid hiding controls that then flash back in. */
export function useIsAdmin(): boolean {
  const { data: status } = useAuthStatus()
  return !status || status.role === 'admin'
}
