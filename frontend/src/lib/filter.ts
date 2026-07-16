import type { Level } from '../types'

/**
 * Level chips are quick toggles appended to the filter; active signals are AND-ed in
 * the same way (docs/frontend.md).
 */
export function combineFilter(
  searchText: string,
  activeLevels: ReadonlySet<Level>,
  activeSignalFilters: string[] = [],
): string | undefined {
  const parts: string[] = []
  const trimmed = searchText.trim()
  if (trimmed) parts.push(`(${trimmed})`)
  if (activeLevels.size > 0) {
    const clause = [...activeLevels].map((level) => `@Level = '${level}'`).join(' or ')
    parts.push(activeLevels.size > 1 ? `(${clause})` : clause)
  }
  for (const signalFilter of activeSignalFilters) {
    parts.push(`(${signalFilter})`)
  }
  return parts.length > 0 ? parts.join(' and ') : undefined
}

/** Quotes a value as a filter string literal (embedded quotes doubled). */
export function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
