import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acknowledgeAlert, createAlert, deleteAlert, getAlerts, resumeAlert, updateAlert } from '../api/alerts'
import type { AlertRequest } from '../api/alerts'

const ALERTS_KEY = ['alerts']

/** Polled at the rate the server evaluates rules: the dashboard's alarm state is read from
 *  these rows, and a state that only refreshed on navigation would be a state nobody sees. */
export function useAlerts() {
  return useQuery({ queryKey: ALERTS_KEY, queryFn: getAlerts, refetchInterval: 60_000 })
}

export function useCreateAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: AlertRequest) => createAlert(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  })
}

export function useUpdateAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, request }: { id: number; request: AlertRequest }) => updateAlert(id, request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  })
}

export function useDeleteAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAlert(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  })
}

/** Silences a firing rule for a while, or lifts the silence (minutes null). */
export function useAcknowledgeAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number | null }) =>
      minutes === null ? resumeAlert(id) : acknowledgeAlert(id, minutes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERTS_KEY }),
  })
}
