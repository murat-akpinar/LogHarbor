import { expect, it } from 'vitest'
import type { OperationOverview } from '../types'
import { operationFilter } from './operations'

function op(overrides: Partial<OperationOverview>): OperationOverview {
  return {
    template: 'GET /articles',
    total: 10,
    errorCount: 0,
    p95ElapsedMs: 100,
    method: 'GET',
    route: '/articles',
    ...overrides,
  }
}

// the whole point of grouping by route: one message template covers every route the app serves,
// so a template filter would open all of them instead of the row that was clicked
it('filters a route row by the properties it was grouped on', () => {
  expect(operationFilter(op({}))).toBe("Path = '/articles' and Method = 'GET'")
})

it('leaves the verb out when the events did not carry one', () => {
  expect(operationFilter(op({ method: null }))).toBe("Path = '/articles'")
})

it('falls back to the template for a group that is not a route', () => {
  expect(operationFilter(op({ template: 'Processed job {JobId}', method: null, route: null }))).toBe(
    "@MessageTemplate = 'Processed job {JobId}'",
  )
})

it('uses the property names the page is configured with', () => {
  expect(operationFilter(op({ method: 'PUT', route: '/cart' }), 'RequestPath', 'RequestMethod')).toBe(
    "RequestPath = '/cart' and RequestMethod = 'PUT'",
  )
})
