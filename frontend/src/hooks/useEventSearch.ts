import { useInfiniteQuery } from '@tanstack/react-query'
import { getEvents } from '../api/events'

const PAGE_SIZE = 100

interface UseEventSearchParams {
  filter: string | undefined
  from: string | undefined
  to: string | undefined
}

export function useEventSearch({ filter, from, to }: UseEventSearchParams) {
  return useInfiniteQuery({
    queryKey: ['events', filter, from, to],
    queryFn: ({ pageParam }) => getEvents({ filter, from, to, count: PAGE_SIZE, afterId: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.events.at(-1)?.id : undefined),
  })
}
