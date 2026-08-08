import { describe, expect, it } from 'vitest'
import { formatRelative, formatSpan, formatTimestamp } from './dates'

describe('formatRelative', () => {
  it('formats in English for en', () => {
    const iso = new Date(Date.now() - 3 * 60_000).toISOString()
    expect(formatRelative(iso, 'en')).toBe('3 minutes ago')
  })

  it('formats in Turkish for tr', () => {
    const iso = new Date(Date.now() - 3 * 60_000).toISOString()
    expect(formatRelative(iso, 'tr')).toBe('3 dakika önce')
  })
})

describe('formatSpan', () => {
  it('names a length, not a moment', () => {
    // the distinction the function exists for: "4 hours" goes inside a sentence about a
    // stretch of history, where formatRelative's "4 hours ago" would name a point instead
    expect(formatSpan(4 * 3600, 'en')).toBe('4 hours')
    expect(formatSpan(4 * 3600, 'tr')).toBe('4 saat')
  })

  it('picks the unit the length reads best in', () => {
    expect(formatSpan(45 * 60, 'en')).toBe('45 minutes')
    expect(formatSpan(24 * 3600, 'en')).toBe('1 day')
  })
})

describe('formatTimestamp', () => {
  it('produces different localized output for en vs tr', () => {
    // 15 August so day/month order differences show up: en 8/15, tr 15.08
    const iso = '2026-08-15T12:00:00.000Z'
    expect(formatTimestamp(iso, 'en-US')).not.toBe(formatTimestamp(iso, 'tr-TR'))
  })
})
