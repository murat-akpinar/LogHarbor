import { describe, expect, it } from 'vitest'
import { chipLabel, compileChips, parseChips, type Chip } from './filterChips'

const ROUND_TRIP: Chip[][] = [
  [{ kind: 'text', text: 'timeout' }],
  [{ kind: 'field', field: '@Level', op: 'is', value: 'Error' }],
  [{ kind: 'field', field: '@Level', op: 'is-not', value: 'Information' }],
  [{ kind: 'field', field: 'RequestPath', op: 'starts-with', value: '/api/' }],
  [{ kind: 'field', field: 'RequestPath', op: 'ends-with', value: '.json' }],
  [{ kind: 'field', field: 'User', op: 'contains', value: "O'Brien" }],
  [{ kind: 'field', field: 'StatusCode', op: 'gte', value: '500' }],
  [{ kind: 'field', field: 'Elapsed', op: 'lt', value: '10' }],
  [{ kind: 'exists', field: '@Exception', present: true }],
  [{ kind: 'exists', field: '@Exception', present: false }],
  [{ kind: 'exists', field: 'OrderId', present: true }],
  [
    { kind: 'text', text: 'timeout' },
    { kind: 'field', field: '@Level', op: 'is', value: 'Error' },
  ],
]

describe('compileChips / parseChips round-trip', () => {
  for (const chips of ROUND_TRIP) {
    it(compileChips(chips) || '(empty)', () => {
      expect(parseChips(compileChips(chips))).toEqual(chips)
    })
  }
  it('empty list compiles to empty string and parses to []', () => {
    expect(compileChips([])).toBe('')
    expect(parseChips('')).toEqual([])
  })
})

describe('parseChips bails to raw (null) on anything the builder never emits', () => {
  for (const text of [
    '(A = 1 or B = 2)',
    'A = 1 or B = 2',
    'not X = 1',
    "P like '%middle%'",
    'garbage tokens here',
  ]) {
    it(text, () => expect(parseChips(text)).toBeNull())
  }
})

describe('quoting', () => {
  it('doubles an embedded quote in a text chip', () => {
    expect(compileChips([{ kind: 'text', text: "O'Brien" }])).toBe("'O''Brien'")
  })
  it('keeps a numeric value unquoted', () => {
    expect(compileChips([{ kind: 'field', field: 'N', op: 'is', value: '42' }])).toBe('N = 42')
  })
  it('quotes a non-numeric value', () => {
    expect(compileChips([{ kind: 'field', field: 'S', op: 'is', value: 'x' }])).toBe("S = 'x'")
  })
})

describe('chipLabel', () => {
  it('drops the @ and reads naturally', () => {
    expect(chipLabel({ kind: 'field', field: '@Level', op: 'is', value: 'Error' })).toBe('Level is Error')
    expect(chipLabel({ kind: 'exists', field: '@Exception', present: false })).toBe('Exception is not set')
    expect(chipLabel({ kind: 'text', text: 'timeout' })).toBe('"timeout"')
  })
})
