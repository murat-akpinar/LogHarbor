// @vitest-environment jsdom
import { expect, it, describe } from 'vitest'
import { en } from '../i18n/en'
import type { StorageForecast } from '../types'
import { describeArchiveTimeline, describeStorageForecast } from './SettingsPage'

const t = en.settings.timeline

describe('describeArchiveTimeline', () => {
  it('spells out the three phases in order', () => {
    const result = describeArchiveTimeline(
      { compressAfterDays: '1', retentionDays: '7' },
      t,
    )

    expect(result).toEqual({
      text: 'hot and searchable for 1 d → compressed on disk from 1 to 7 d → deleted after 7 d',
      warning: false,
    })
  })

  // the exact misconfiguration the API rejects; the page should say so before the save round-trip
  it('warns when deletion comes before compression', () => {
    const result = describeArchiveTimeline(
      { compressAfterDays: '90', retentionDays: '30' },
      t,
    )

    expect(result?.warning).toBe(true)
    expect(result?.text).toMatch(/same pass/)
  })

  it('describes the archiving-off case instead of an empty middle phase', () => {
    const result = describeArchiveTimeline(
      { compressAfterDays: '0', retentionDays: '14' },
      t,
    )

    expect(result).toEqual({ text: 'Archiving is off: events stay hot and are deleted after 14 d.', warning: false })
  })

  it('says nothing while a field is empty or unparseable', () => {
    const base = { compressAfterDays: '1', retentionDays: '7' }

    expect(describeArchiveTimeline({ ...base, retentionDays: '' }, t)).toBeNull()
    expect(describeArchiveTimeline({ ...base, compressAfterDays: 'abc' }, t)).toBeNull()
  })
})

const MB = 1024 * 1024
const forecastText = en.settings.forecast

function forecast(overrides: Partial<StorageForecast> = {}): StorageForecast {
  return {
    databaseBytes: 100 * MB,
    maxDatabaseBytes: 0,
    sampleCount: 24,
    observedHours: 23,
    dailyGrowthBytes: 24 * MB,
    daysUntilFull: null,
    oldestDay: '2026-07-19',
    status: 'growing',
    ...overrides,
  }
}

describe('describeStorageForecast', () => {
  it('admits it has no trend yet instead of extrapolating from one reading', () => {
    const result = describeStorageForecast(
      forecast({ status: 'measuring', sampleCount: 1, observedHours: 0, dailyGrowthBytes: null }),
      forecastText,
    )

    expect(result).toEqual({ text: forecastText.measuring, warning: false })
  })

  it('gives a rate but no date when no ceiling is configured', () => {
    const result = describeStorageForecast(forecast(), forecastText)

    expect(result.text).toBe('Growing 24.0 MB/day over the last 23 h.')
    expect(result.warning).toBe(false)
  })

  it('counts down to the ceiling and names the day that goes first', () => {
    const result = describeStorageForecast(
      forecast({ maxDatabaseBytes: 340 * MB, daysUntilFull: 10, observedHours: 72 }),
      forecastText,
    )

    expect(result.text).toBe(
      'Growing 24.0 MB/day over the last 3 days. Reaches the ceiling in about 10 days. ' +
      '2026-07-19 would be the first day dropped.',
    )
    expect(result.warning).toBe(false)
  })

  it('warns once the ceiling is within a week', () => {
    const result = describeStorageForecast(
      forecast({ maxDatabaseBytes: 200 * MB, daysUntilFull: 4 }),
      forecastText,
    )

    expect(result.warning).toBe(true)
  })

  it('does not round a countdown of hours down to "0 days"', () => {
    const result = describeStorageForecast(
      forecast({ maxDatabaseBytes: 105 * MB, daysUntilFull: 0.2 }),
      forecastText,
    )

    expect(result.text).toContain('under a day')
    expect(result.text).not.toContain('0 days')
  })

  it('reports a flat file as steady rather than as a date', () => {
    const result = describeStorageForecast(
      forecast({ status: 'steady', dailyGrowthBytes: 0, maxDatabaseBytes: 200 * MB }),
      forecastText,
    )

    expect(result).toEqual({ text: 'Not growing over the last 23 h of recorded sizes.', warning: false })
  })

  it('warns while the cap is actively dropping days', () => {
    const result = describeStorageForecast(
      forecast({ status: 'at-ceiling', maxDatabaseBytes: 100 * MB, daysUntilFull: 0 }),
      forecastText,
    )

    expect(result.warning).toBe(true)
    expect(result.text).toContain('2026-07-19 would be the first day dropped.')
  })
})
