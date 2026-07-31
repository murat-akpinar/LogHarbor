import type { Level } from '../types'

export const LEVELS: Level[] = ['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal']

// docs/frontend.md LEVEL COLORS. Every level has its own hue — violet, cyan, blue, amber,
// red, rose — so a row's severity is readable from colour alone, at a glance, in both themes.
export const LEVEL_TEXT: Record<Level, string> = {
  Verbose: 'text-level-verbose',
  Debug: 'text-level-debug',
  Information: 'text-level-information',
  Warning: 'text-level-warning',
  Error: 'text-level-error',
  Fatal: 'text-level-fatal',
}

export const LEVEL_CODE: Record<Level, string> = {
  Verbose: 'VRB',
  Debug: 'DBG',
  Information: 'INF',
  Warning: 'WRN',
  Error: 'ERR',
  Fatal: 'FTL',
}

// In a chart, colour means trouble and nothing else. Everything below Warning draws in one
// neutral, so a healthy window is a single grey shape and a bad hour is visible from across
// the room without reading a legend. Levels keep their own hues everywhere they are *named*
// — chips, tooltips, the event list — which is what LEVEL_HEX below is for.
export const LEVEL_CHART: Record<Level, string> = {
  Verbose: 'var(--color-chart-neutral)',
  Debug: 'var(--color-chart-neutral)',
  Information: 'var(--color-chart-neutral)',
  Warning: 'var(--color-level-warning)',
  Error: 'var(--color-level-error)',
  Fatal: 'var(--color-level-fatal)',
}

/** The levels that draw neutral, in stacking order, and the ones that draw in their own hue. */
export const QUIET_LEVELS: Level[] = ['Verbose', 'Debug', 'Information']
export const ALERT_LEVELS: Level[] = ['Warning', 'Error', 'Fatal']

/** Every level in one bucket, summed: what the bucket holds regardless of severity. */
export function sumLevels(counts: Record<Level, number>): number {
  return LEVELS.reduce((total, level) => total + counts[level], 0)
}

export interface BarSegment {
  key: string
  count: number
  color: string
  /** Warning and above: the segment glows. Neutral traffic does not — see barGlow in lib/series. */
  lit: boolean
}

/**
 * One bar's parts, bottom up.
 *
 * The quiet levels are summed into a single neutral block rather than stacked as three: drawn
 * separately they are three bands of the same colour, and the seams read as data that is not
 * there. Warning and above keep their own segment because that is the thing worth seeing.
 */
export function barSegments(counts: Record<Level, number>): BarSegment[] {
  const quiet = QUIET_LEVELS.reduce((total, level) => total + counts[level], 0)
  return [
    { key: 'quiet', count: quiet, color: LEVEL_CHART.Information, lit: false },
    ...ALERT_LEVELS.map((level) => ({
      key: level,
      count: counts[level],
      color: LEVEL_CHART[level],
      lit: true,
    })),
  ].filter((segment) => segment.count > 0)
}

// CSS variable references, not hex: every consumer (Histogram, Heatmap, AnalysisPage) sets
// these as an inline style (backgroundColor), never a Tailwind class, so pointing at the
// same tokens the rest of the UI uses lets chart colours follow the active theme.
export const LEVEL_HEX: Record<Level, string> = {
  Verbose: 'var(--color-level-verbose)',
  Debug: 'var(--color-level-debug)',
  Information: 'var(--color-level-information)',
  Warning: 'var(--color-level-warning)',
  Error: 'var(--color-level-error)',
  Fatal: 'var(--color-level-fatal)',
}
