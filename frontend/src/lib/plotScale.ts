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
