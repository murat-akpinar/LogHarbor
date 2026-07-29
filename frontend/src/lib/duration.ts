/** 830 -> "830 ms", 4100 -> "4.1 s". A route's p95 can sit in either unit, and reading four
 *  digits of milliseconds next to three is how a slow one gets missed. */
export function formatDuration(ms: number | null, locale: string): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms).toLocaleString(locale)} ms`
  return `${(ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`
}
