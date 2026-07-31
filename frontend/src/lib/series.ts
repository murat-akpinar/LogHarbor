/**
 * The colour of a measured series, as opposed to the colour of a severity.
 *
 * Two rules run the charts and they do not conflict, because they apply to different marks:
 *
 *   BARS are neutral by default. A histogram counts things, and if every count had a colour a
 *   busy hour and a broken hour would look equally loud. Only Warning and above take a hue —
 *   see LEVEL_CHART in lib/levels.
 *
 *   LINES are named. A lane holding an average and a p95 has to say which is which, and two
 *   greys cannot; a tile's sparkline has to say what it is the shape of. So every measured
 *   series owns one hue and keeps it wherever it appears — the lane, the tile and the chip all
 *   draw p95 in the same violet, which is what lets a reader carry a series from one to another.
 *
 * These are CSS variable references rather than hex, like LEVEL_HEX: consumers set them as an
 * inline style or an SVG stroke, and pointing at the token keeps the palette in one file.
 */
export const SERIES = {
  /** How much arrived. */
  volume: 'var(--color-series-volume)',
  /** How long it took, on average. */
  avg: 'var(--color-series-avg)',
  /** How long it took for the slow tail — the one people actually feel. */
  p95: 'var(--color-series-p95)',
  /** How much failed. */
  errors: 'var(--color-series-errors)',
} as const

export type SeriesName = keyof typeof SERIES
