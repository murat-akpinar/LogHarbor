export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString()
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const RELATIVE_STEPS: [unitSeconds: number, upTo: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [1, 60, 'second'],
  [60, 3600, 'minute'],
  [3600, 86400, 'hour'],
  [86400, 2592000, 'day'],
  [2592000, 31536000, 'month'],
  [31536000, Infinity, 'year'],
]

export function formatRelative(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const magnitude = Math.abs(seconds)
  const [unitSeconds, , unit] = RELATIVE_STEPS.find(([, upTo]) => magnitude < upTo)!
  return RELATIVE_FORMAT.format(Math.round(seconds / unitSeconds), unit)
}

/** datetime-local inputs carry no timezone; interpret as local time and emit UTC ISO for the API. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
