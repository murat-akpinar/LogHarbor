// @vitest-environment jsdom
import { expect, it, describe } from 'vitest'
import { en } from '../i18n/en'
import { describeArchiveTimeline } from './SettingsPage'

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
