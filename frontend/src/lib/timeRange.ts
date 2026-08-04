/** The windows a log reader actually reaches for, and the arithmetic to name one. */
export type PresetKey =
  | 'last5m'
  | 'last15m'
  | 'lastHour'
  | 'last3h'
  | 'last6h'
  | 'last12h'
  | 'last24h'

export const PRESETS: { key: PresetKey; minutes: number }[] = [
  { key: 'last5m', minutes: 5 },
  { key: 'last15m', minutes: 15 },
  { key: 'lastHour', minutes: 60 },
  { key: 'last3h', minutes: 180 },
  { key: 'last6h', minutes: 360 },
  { key: 'last12h', minutes: 720 },
  { key: 'last24h', minutes: 1440 },
]

/** What anyone who has set nothing gets: the last hour, as the roadmap asked on 2026-08-01. */
export const DEFAULT_PRESET: PresetKey = 'lastHour'

export function presetMinutes(key: PresetKey): number {
  return PRESETS.find((preset) => preset.key === key)!.minutes
}

/**
 * The preset a width of `minutes` is, or null for a width nobody could have picked — a window
 * brushed out of a chart, mostly. Null is why the picker still knows how to label a window by
 * its two ends: it is what a rolling window that came from a brush has to fall back to.
 */
export function presetForMinutes(minutes: number): PresetKey | null {
  return PRESETS.find((preset) => preset.minutes === minutes)?.key ?? null
}
