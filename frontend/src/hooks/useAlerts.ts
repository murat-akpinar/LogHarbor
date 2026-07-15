import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createAlert, deleteAlert, getAlerts, updateAlert } from '../api/alerts'
import type { AlertRequest } from '../api/alerts'

const ALERTS_KEY = ['alerts']

export function useAlerts() {
  return useQuery({ queryKey: ALERTS_KEY, queryFn: getAlerts })
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
