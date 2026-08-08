import { expect, it } from 'vitest'
import type { Finding, FindingKind } from '../types'
import { FINDING_COLOR, sparklineRange } from './findings'
import { LEVEL_CHART } from './levels'
import { SERIES } from './series'

const KINDS: FindingKind[] = ['went_quiet', 'new_exception', 'failing_route', 'slower_than_usual']

function finding(kind: FindingKind): Finding {
  return { kind, subject: 'x', filter: 'x', now: 1, baseline: 1, count: 1 }
}

// the point of the mapping: a reader carries the meaning across from the tiles and the timeline
// without learning a second colour language for this band
it('draws each measured kind in the hue this dashboard already uses for that measurement', () => {
  expect(FINDING_COLOR.slower_than_usual).toBe(SERIES.p95)
  expect(FINDING_COLOR.failing_route).toBe(SERIES.errors)
  expect(FINDING_COLOR.went_quiet).toBe(SERIES.volume)
  expect(FINDING_COLOR.new_exception).toBe(LEVEL_CHART.Warning)
})

it('gives every kind a hue, and no two kinds the same one', () => {
  const hues = KINDS.map((kind) => FINDING_COLOR[kind])
  expect(hues.every(Boolean)).toBe(true)
  expect(new Set(hues).size).toBe(KINDS.length)
})

it('draws a finding over the range the reader picked', () => {
  const range = sparklineRange(finding('slower_than_usual'), '2026-08-08T09:00:00.000Z', '2026-08-08T10:00:00.000Z')

  expect(range).toEqual({ from: '2026-08-08T09:00:00.000Z', to: '2026-08-08T10:00:00.000Z' })
})

// a service that sent nothing has an empty strip, which is a picture of no data rather than a
// picture of stopping. Reaching back over the detector's own baseline draws it running and then
// flatlining — the finding itself, with no number to read.
it('reaches back over the baseline for a silence, so the strip shows it stopping', () => {
  const range = sparklineRange(finding('went_quiet'), '2026-08-08T09:00:00.000Z', '2026-08-08T10:00:00.000Z')

  expect(range.to).toBe('2026-08-08T10:00:00.000Z')
  expect(range.from).toBe('2026-08-08T05:00:00.000Z')   // four windows back, matching the scanner
})
