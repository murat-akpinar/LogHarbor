import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../api/settings'

/**
 * What the server says about itself, including how many events it holds in total.
 *
 * Shared rather than inlined per page so the key stays one key: Settings shows the figure and
 * Events asks it a yes/no question — whether this is a first run with nothing ingested yet —
 * and two spellings of the same query would fetch it twice.
 */
export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: getHealth })
}
