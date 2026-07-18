import { expect, it } from 'vitest'
import { buildTraceLayout, matchTraceFilter } from './trace'
import type { Event } from '../types'

const TRACE = '0af7651916cd43dd8448eb211c80319c'

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 1,
    timestamp: '2026-07-18T10:00:00.000Z',
    level: 'Information',
    message: 'msg',
    messageTemplate: null,
    properties: null,
    exception: null,
    ingestedAt: '2026-07-18T10:00:00.000Z',
    traceId: TRACE,
    spanId: null,
    ...overrides,
  }
}

it('matches the exact trace filter, with or without combineFilter parens', () => {
  expect(matchTraceFilter(`@TraceId = '${TRACE}'`)).toBe(TRACE)
  expect(matchTraceFilter(`(@TraceId = '${TRACE}')`)).toBe(TRACE)
})

it('rejects anything that is not exactly one trace filter', () => {
  expect(matchTraceFilter(undefined)).toBeNull()
  expect(matchTraceFilter("@Level = 'Error'")).toBeNull()
  expect(matchTraceFilter(`(@TraceId = '${TRACE}') and @Level = 'Error'`)).toBeNull()
  expect(matchTraceFilter(`@TraceId = 'not-hex'`)).toBeNull()
  expect(matchTraceFilter(`(@TraceId = '${TRACE}'`)).toBeNull()
})

it('groups events into spans ordered by start, bounds from timestamps', () => {
  const layout = buildTraceLayout([
    // API returns newest first; grouping must not depend on input order
    makeEvent({ id: 4, timestamp: '2026-07-18T10:00:00.300Z', spanId: 'b7ad6b7169203331' }),
    makeEvent({ id: 3, timestamp: '2026-07-18T10:00:00.250Z', spanId: 'c8be7c8279314442', level: 'Error', message: 'boom' }),
    makeEvent({ id: 2, timestamp: '2026-07-18T10:00:00.100Z', spanId: 'b7ad6b7169203331', properties: '{"service.name":"checkout"}' }),
    makeEvent({ id: 1, timestamp: '2026-07-18T10:00:00.000Z', spanId: 'c8be7c8279314442', properties: '{"Service":"worker"}' }),
  ])!

  expect(layout.startMs).toBe(Date.parse('2026-07-18T10:00:00.000Z'))
  expect(layout.endMs).toBe(Date.parse('2026-07-18T10:00:00.300Z'))
  expect(layout.spans.map((span) => span.spanId)).toEqual(['c8be7c8279314442', 'b7ad6b7169203331'])
  const [first, second] = layout.spans
  expect(first.service).toBe('worker')
  expect(first.hasError).toBe(true)
  expect(first.endMs - first.startMs).toBe(250)
  expect(second.service).toBe('checkout')
  expect(second.hasError).toBe(false)
  expect(second.events.map((event) => event.id)).toEqual([2, 4])
})

it('collects spanless events into a trailing null-span row', () => {
  const layout = buildTraceLayout([
    makeEvent({ id: 1, timestamp: '2026-07-18T10:00:00.000Z' }),
    makeEvent({ id: 2, timestamp: '2026-07-18T10:00:00.100Z', spanId: 'b7ad6b7169203331' }),
  ])!

  expect(layout.spans.map((span) => span.spanId)).toEqual(['b7ad6b7169203331', null])
})

it('labels a span with its first event template, falling back to message', () => {
  const layout = buildTraceLayout([
    makeEvent({ id: 1, messageTemplate: 'GET {Path}', spanId: 'b7ad6b7169203331' }),
    makeEvent({ id: 2, message: 'plain', spanId: 'c8be7c8279314442' }),
  ])!

  expect(layout.spans.map((span) => span.label)).toEqual(['GET {Path}', 'plain'])
})

it('returns null for no events and survives malformed properties JSON', () => {
  expect(buildTraceLayout([])).toBeNull()
  const layout = buildTraceLayout([makeEvent({ properties: '{oops', spanId: 'b7ad6b7169203331' })])!
  expect(layout.spans[0].service).toBeNull()
})
