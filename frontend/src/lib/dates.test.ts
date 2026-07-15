import { describe, expect, it } from 'vitest'
import { formatRelative, formatTimestamp } from './dates'

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

describe('formatTimestamp', () => {
  it('produces different localized output for en vs tr', () => {
    // 15 August so day/month order differences show up: en 8/15, tr 15.08
    const iso = '2026-08-15T12:00:00.000Z'
    expect(formatTimestamp(iso, 'en-US')).not.toBe(formatTimestamp(iso, 'tr-TR'))
  })
})
