import { useQuery } from '@tanstack/react-query'
import { getEvents } from '../api/events'
import { quote } from '../lib/filter'

/** The whole trace in one fetch; the API caps count at 1000, newest first. */
export function useTraceEvents(traceId: string) {
  return useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => getEvents({ filter: `@TraceId = ${quote(traceId)}`, count: 1000 }),
  })
}
