import { describe, expect, it } from 'vitest'
import { axisTicks } from './timeAxis'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Local time, so the assertions below say the same thing wherever they run. */
function at(year: number, month: number, day: number, hour = 0, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString()
}

function span(fromIso: string, ms: number): string {
  return new Date(new Date(fromIso).getTime() + ms).toISOString()
}

describe('axisTicks', () => {
  it('never puts more labels on the axis than the caller has room for', () => {
    const from = at(2026, 7, 31, 9, 17)
    for (const width of [HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY]) {
      for (const target of [3, 6, 10]) {
        expect(axisTicks(from, span(from, width), target).length).toBeLessThanOrEqual(target + 1)
      }
    }
  })

  it('picks a step the reader would name out loud, not a slice of the window', () => {
    // an hour ticks in ten-minute steps, on the ten-minute marks
    const from = at(2026, 7, 31, 9, 17)
    const ticks = axisTicks(from, span(from, HOUR), 6, 'en')
    expect(ticks.length).toBeGreaterThan(2)
    for (const tick of ticks) {
      expect(tick.label).toMatch(/^\d{2}:\d0/)
    }
  })

  it('lands its ticks on round local boundaries rather than on the window start', () => {
    // 09:17 is not a boundary; the first tick after it is 09:30 at a half-hour step
    const from = at(2026, 7, 31, 9, 17)
    const ticks = axisTicks(from, span(from, 6 * HOUR), 6)
    const first = new Date(new Date(from).getTime() + ticks[0].position * 6 * HOUR)
    expect(first.getMinutes()).toBe(0)
    expect(first.getSeconds()).toBe(0)
  })

  it('names the day instead of the clock once a tick lands on midnight', () => {
    // a window straddling midnight: the 00:00 tick says which day, the rest say the time
    const from = at(2026, 7, 30, 21, 0)
    const ticks = axisTicks(from, span(from, 6 * HOUR), 8, 'en')
    const dayTicks = ticks.filter((tick) => tick.isDay)
    expect(dayTicks).toHaveLength(1)
    expect(dayTicks[0].label).not.toMatch(/:/)
  })

  it('labels every tick with a date once the step is a day or more', () => {
    const from = at(2026, 7, 1)
    const ticks = axisTicks(from, span(from, 14 * DAY), 8, 'en')
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.every((tick) => tick.isDay)).toBe(true)
  })

  it('keeps every position inside the plot', () => {
    const from = at(2026, 7, 31, 9, 17)
    for (const tick of axisTicks(from, span(from, 3 * DAY), 8)) {
      expect(tick.position).toBeGreaterThanOrEqual(0)
      expect(tick.position).toBeLessThanOrEqual(1)
    }
  })

  // a chart that has not loaded yet, or a range picker mid-edit, must not throw at it
  it('answers nothing for a window that is empty, backwards or unparseable', () => {
    const from = at(2026, 7, 31)
    expect(axisTicks(from, from, 6)).toEqual([])
    expect(axisTicks(span(from, HOUR), from, 6)).toEqual([])
    expect(axisTicks('not a date', from, 6)).toEqual([])
    expect(axisTicks(from, span(from, DAY), 1)).toEqual([])
  })
})
