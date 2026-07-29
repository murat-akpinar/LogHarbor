import type { OperationOverview } from '../types'
import { quote } from './filter'

/** What the server groups routes by unless a page overrides it. Serilog's ASP.NET middleware
 *  writes RequestPath/RequestMethod and OTel writes http.route, so this is only a default. */
export const ROUTE_PROPERTY = 'Path'
export const METHOD_PROPERTY = 'Method'

/**
 * The filter that selects exactly the events a row was aggregated from.
 *
 * A route group was not grouped by message template — one template covers every route the app
 * serves — so filtering by the template would open all of them. Template groups (jobs, probes)
 * still filter by template, because that is what identified them.
 */
export function operationFilter(
  operation: OperationOverview,
  routeProperty = ROUTE_PROPERTY,
  methodProperty = METHOD_PROPERTY,
): string {
  // falsy, not null: a response from a server older than route grouping carries neither field
  if (!operation.route) {
    return `@MessageTemplate = ${quote(operation.template)}`
  }
  const clauses = [`${routeProperty} = ${quote(operation.route)}`]
  if (operation.method) {
    clauses.push(`${methodProperty} = ${quote(operation.method)}`)
  }
  return clauses.join(' and ')
}
