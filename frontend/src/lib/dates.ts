export function formatTimestamp(iso: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale)
}

// Intl.RelativeTimeFormat construction is not free; cache one instance per locale
const RELATIVE_FORMATS = new Map<string, Intl.RelativeTimeFormat>()

function relativeFormat(locale?: string): Intl.RelativeTimeFormat {
  const key = locale ?? 'default'
  let format = RELATIVE_FORMATS.get(key)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    RELATIVE_FORMATS.set(key, format)
  }
  return format
}

const RELATIVE_STEPS: [unitSeconds: number, upTo: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [1, 60, 'second'],
  [60, 3600, 'minute'],
  [3600, 86400, 'hour'],
  [86400, 2592000, 'day'],
  [2592000, 31536000, 'month'],
  [31536000, Infinity, 'year'],
]

export function formatRelative(iso: string, locale?: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const magnitude = Math.abs(seconds)
  const [unitSeconds, , unit] = RELATIVE_STEPS.find(([, upTo]) => magnitude < upTo)!
  return relativeFormat(locale).format(Math.round(seconds / unitSeconds), unit)
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
