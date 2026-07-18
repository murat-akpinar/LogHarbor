import { useQuery } from '@tanstack/react-query'
import { getTrace } from '../api/traces'

/** Real spans for a trace; empty when the trace has none (log-only senders). */
export function useTrace(traceId: string) {
  return useQuery({
    queryKey: ['trace-spans', traceId],
    queryFn: () => getTrace(traceId),
  })
}
