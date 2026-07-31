/**
 * The value the tallest bar is drawn against.
 *
 * A plain maximum, not a rounded one: these charts carry no y-axis and no ticks, so rounding
 * 22 up to 50 buys no round number anyone can read and spends half the plot on air. The sliver
 * of headroom keeps the tallest bar off the ceiling, where it would look clipped.
 */
export function plotMax(values: number[]): number {
  return Math.max(1, ...values) * 1.06
}

/** How long a chart takes to finish growing in, however many columns it has. */
export const SWEEP_MS = 380

/**
 * One column's share of the entrance sweep, in milliseconds.
 *
 * A chart grows in left to right, oldest bucket first, which is the direction it was recorded
 * in. The whole sweep is capped rather than each step, so it takes the same time at 30 columns
 * as at 120: a per-column constant would make a wide chart take four times as long to arrive,
 * and its last column would land well after the reader had looked at it.
 */
export function sweep(index: number, columns: number): number {
  return columns <= 1 ? 0 : Math.round((index / (columns - 1)) * SWEEP_MS)
}
