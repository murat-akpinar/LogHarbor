import { LEVEL_CHART } from './levels'

/** The property an HTTP status code is logged under, unless a sink spells it otherwise. */
export const STATUS_PROPERTY = 'StatusCode'

/** Status classes as query-language filters; pages reuse them to narrow their tables. */
export const STATUS_FILTERS = {
  ok: `${STATUS_PROPERTY} < 400`,
  client: `${STATUS_PROPERTY} >= 400 and ${STATUS_PROPERTY} < 500`,
  server: `${STATUS_PROPERTY} >= 500`,
} as const

export type StatusClass = keyof typeof STATUS_FILTERS

/**
 * What the page is narrowed to: a whole class, or one exact code.
 *
 * The class is the shape of an hour; the code is the story. 500, 502 and 503 mean the
 * application threw, the upstream is gone, and the service is shedding load — three different
 * mornings, drawn in one red until a code can be singled out.
 */
export type StatusSelection = { kind: 'class'; value: StatusClass } | { kind: 'code'; value: number }

/** The query-language filter a selection stands for; undefined for "every class". */
export function statusFilter(selection: StatusSelection | null): string | undefined {
  if (selection === null) return undefined
  return selection.kind === 'class' ? STATUS_FILTERS[selection.value] : `${STATUS_PROPERTY} = ${selection.value}`
}

/**
 * Which class a code counts as — the same cuts STATUS_FILTERS makes, so a code chip and the band
 * it belongs to can never disagree about where 499 goes.
 */
export function statusClassOf(code: number): StatusClass {
  if (code >= 500) return 'server'
  if (code >= 400) return 'client'
  return 'ok'
}

// the healthy class draws neutral: a wall of colour says nothing, and 4xx/5xx have to be the
// only things in a request chart that catch the eye. `lit` carries that same rule into the
// bar's bloom — a healthy window glows nowhere.
export const STATUS_COLOR: Record<StatusClass, string> = {
  ok: LEVEL_CHART.Information,
  client: LEVEL_CHART.Warning,
  server: LEVEL_CHART.Error,
}

export const STATUS_SERIES: { key: StatusClass; label: string; color: string; lit: boolean }[] = [
  { key: 'ok', label: '1/2/3xx', color: STATUS_COLOR.ok, lit: false },
  { key: 'client', label: '4xx', color: STATUS_COLOR.client, lit: true },
  { key: 'server', label: '5xx', color: STATUS_COLOR.server, lit: true },
]
