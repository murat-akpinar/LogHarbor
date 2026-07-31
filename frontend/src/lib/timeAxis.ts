/**
 * Where the labels go under a plot, and what they say.
 *
 * Until now these charts carried only the window's two ends, on the argument that a reader can
 * place a bar between them. Asked for on 2026-07-31 and correct: at 120 columns over an
 * arbitrary window, "which hour is that spike in" is arithmetic the reader should not be doing.
 * So there is an axis now — still no gridlines and no y-axis, because those buy nothing here.
 *
 * The step is chosen, not fixed. A one-hour window ticks every ten minutes and a fourteen-day
 * one ticks every two days, so the axis carries roughly the same number of labels either way
 * and each one lands on a round boundary a person would name out loud.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The ladder of steps, smallest first. Every one of them divides its next unit evenly. */
const STEPS = [
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  28 * DAY,
]

export interface AxisTick {
  /** 0..1 across the plot. */
  position: number
  label: string
  /** Midnight, or the first tick of a step of a day or more: labelled with the date instead of
   *  a clock time, so a multi-day window says which day without every label carrying one. */
  isDay: boolean
}

/**
 * Ticks for a window, aligned to round local boundaries.
 *
 * `target` is how many labels the caller has room for; the step is the smallest one on the
 * ladder that does not exceed it. Steps of a day or more are aligned to local midnight rather
 * than to a multiple of the epoch, which is the difference between ticks landing on "00:00 on
 * the 3rd" and on "07:00 on the 3rd" for anyone east or west of UTC.
 */
export function axisTicks(fromIso: string, toIso: string, target: number, locale?: string): AxisTick[] {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  const span = to - from
  if (!Number.isFinite(span) || span <= 0 || target < 2) return []

  const step = STEPS.find((candidate) => span / candidate <= target) ?? STEPS[STEPS.length - 1]
  const ticks: AxisTick[] = []

  for (let at = firstTickAtOrAfter(from, step); at <= to; at += step) {
    const date = new Date(at)
    // a tick that lands on local midnight names its day; so does every tick once the step is a
    // day or more, because then a clock time would read 00:00 on every one of them
    const isDay = step >= DAY || (date.getHours() === 0 && date.getMinutes() === 0)
    ticks.push({
      position: (at - from) / span,
      label: isDay ? formatDay(date, locale) : formatClock(date, locale),
      isDay,
    })
  }

  return ticks
}

/**
 * The first round boundary at or after `from`.
 *
 * Sub-day steps divide the day evenly, so aligning them against local midnight and aligning
 * them against the epoch give the same answer wherever the offset is a whole number of hours —
 * but not in India or Nepal, whose offsets are not. Aligning against midnight is right in both.
 */
function firstTickAtOrAfter(from: number, step: number): number {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const midnight = start.getTime()
  if (from <= midnight) return midnight
  const elapsed = from - midnight
  return midnight + Math.ceil(elapsed / step) * step
}

function formatClock(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

function formatDay(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}
