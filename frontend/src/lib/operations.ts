import type { OperationOverview } from '../types'
import { quote } from './filter'

/** What the server groups routes by unless a page overrides it. Serilog's ASP.NET middleware
 *  writes RequestPath/RequestMethod and OTel writes http.route, so this is only a default. */
export const ROUTE_PROPERTY = 'Path'
export const METHOD_PROPERTY = 'Method'

/** What the server writes where it folded an id out of a path (backend RoutePath.Placeholder). */
const PLACEHOLDER = '{id}'

/**
 * The filter that selects exactly the events a row was aggregated from.
 *
 * A route group was not grouped by message template — one template covers every route the app
 * serves — so filtering by the template would open all of them. Template groups (jobs, probes)
 * still filter by template, because that is what identified them.
 *
 * A folded row is the one case where the row's own text does not appear in any event: the server
 * put the {id} placeholders there to reunite /api/orders/41973 with /api/orders/8, so the filter
 * has to match the shape instead. `%` and `_` elsewhere in such a path would act as wildcards —
 * the query language's `like` has no escape — which can only widen the match, never narrow it.
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
  const clauses = [
    operation.folded
      ? `${routeProperty} like ${quote(operation.route.replaceAll(PLACEHOLDER, '%'))}`
      : `${routeProperty} = ${quote(operation.route)}`,
  ]
  if (operation.method) {
    clauses.push(`${methodProperty} = ${quote(operation.method)}`)
  }
  return clauses.join(' and ')
}
