import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createSignal, deleteSignal, getSignals, updateSignal } from '../api/signals'
import type { SignalRequest } from '../api/signals'

const SIGNALS_KEY = ['signals']

export function useSignals() {
  return useQuery({ queryKey: SIGNALS_KEY, queryFn: getSignals })
}

export function useCreateSignal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: SignalRequest) => createSignal(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SIGNALS_KEY }),
  })
}

export function useUpdateSignal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, request }: { id: number; request: SignalRequest }) => updateSignal(id, request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SIGNALS_KEY }),
  })
}

export function useDeleteSignal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteSignal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SIGNALS_KEY }),
  })
}
