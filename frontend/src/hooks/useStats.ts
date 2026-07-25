import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getHeatmap, getHistogram, getOperations, getQueries, getServices, getServiceStatus, getSlowOperations, getSummary, getTopErrors, getTopExceptions, getUserActivity } from '../api/stats'
import type { StatsRangeParams } from '../api/stats'

// refetch keeps the previous render instead of flashing a skeleton (dataviz interaction rules)
const KEEP_PREVIOUS = { placeholderData: keepPreviousData }

export function useHistogram(params: StatsRangeParams & { buckets: number }) {
  return useQuery({
    queryKey: ['stats', 'histogram', params],
    queryFn: () => getHistogram(params),
    ...KEEP_PREVIOUS,
  })
}

export function useHeatmap(params: StatsRangeParams) {
  return useQuery({
    queryKey: ['stats', 'heatmap', params],
    queryFn: () => getHeatmap(params),
    ...KEEP_PREVIOUS,
  })
}

export function useSummary(params: StatsRangeParams) {
  return useQuery({
    queryKey: ['stats', 'summary', params],
    queryFn: () => getSummary(params),
    ...KEEP_PREVIOUS,
  })
}

export function useTopErrors(params: StatsRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'top-errors', params],
    queryFn: () => getTopErrors(params),
    ...KEEP_PREVIOUS,
  })
}

export function useTopExceptions(params: StatsRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'top-exceptions', params],
    queryFn: () => getTopExceptions(params),
    ...KEEP_PREVIOUS,
  })
}

export function useServices(params: StatsRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'services', params],
    queryFn: () => getServices(params),
    ...KEEP_PREVIOUS,
  })
}

export function useServiceStatus(params: StatsRangeParams & { staleMinutes?: number; limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'service-status', params],
    queryFn: () => getServiceStatus(params),
    ...KEEP_PREVIOUS,
  })
}

export function useOperations(params: StatsRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'operations', params],
    queryFn: () => getOperations(params),
    ...KEEP_PREVIOUS,
  })
}

export function useUserActivity(params: StatsRangeParams & { property?: string; limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'user-activity', params],
    queryFn: () => getUserActivity(params),
    ...KEEP_PREVIOUS,
  })
}

export function useQueries(params: StatsRangeParams & { property?: string; durationProperty?: string; limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'queries', params],
    queryFn: () => getQueries(params),
    ...KEEP_PREVIOUS,
  })
}

export function useSlowOperations(params: StatsRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['stats', 'slow-operations', params],
    queryFn: () => getSlowOperations(params),
    ...KEEP_PREVIOUS,
  })
}
