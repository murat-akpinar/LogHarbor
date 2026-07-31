import { LEVEL_CHART } from './levels'

/** Status classes as query-language filters; pages reuse them to narrow their tables. */
export const STATUS_FILTERS = {
  ok: 'StatusCode < 400',
  client: 'StatusCode >= 400 and StatusCode < 500',
  server: 'StatusCode >= 500',
} as const

export type StatusClass = keyof typeof STATUS_FILTERS

// the healthy class draws neutral: a wall of colour says nothing, and 4xx/5xx have to be the
// only things in a request chart that catch the eye
export const STATUS_SERIES: { key: StatusClass; label: string; color: string }[] = [
  { key: 'ok', label: '1/2/3xx', color: LEVEL_CHART.Information },
  { key: 'client', label: '4xx', color: LEVEL_CHART.Warning },
  { key: 'server', label: '5xx', color: LEVEL_CHART.Error },
]
