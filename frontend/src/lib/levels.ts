import type { Level } from '../types'

export const LEVELS: Level[] = ['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal']

// docs/frontend.md LEVEL COLORS. Information is deliberately neutral: most events are
// Information, and if every level is coloured then none of them is.
export const LEVEL_TEXT: Record<Level, string> = {
  Verbose: 'text-level-verbose',
  Debug: 'text-level-debug',
  Information: 'text-level-information',
  Warning: 'text-level-warning',
  Error: 'text-level-error',
  Fatal: 'text-level-fatal',
}

export const LEVEL_BAR: Record<Level, string> = {
  Verbose: 'bg-level-verbose',
  Debug: 'bg-level-debug',
  Information: 'bg-level-information',
  Warning: 'bg-level-warning',
  Error: 'bg-level-error',
  Fatal: 'bg-level-fatal',
}

export const LEVEL_CODE: Record<Level, string> = {
  Verbose: 'VRB',
  Debug: 'DBG',
  Information: 'INF',
  Warning: 'WRN',
  Error: 'ERR',
  Fatal: 'FTL',
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
