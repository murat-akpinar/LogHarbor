import type { OperationOverview } from '../types'

/**
 * The verb decides the colour, so a write standing out among reads is visible before reading a
 * single path.
 *
 * One palette, one meaning per hue, everywhere in the app: blue reads, green creates, amber
 * changes, red destroys or fails. These are the level hues, which is what keeps a method chip
 * and a warning bar speaking the same language and both themes' contrast floor holding.
 *
 * Deliberately not extended to the volume charts. Most events are not requests at all, and a
 * red bar that might mean DELETE would stop meaning trouble — which is the one thing a chart
 * colour here is for.
 */
export const METHOD_CLASS: Record<string, string> = {
  GET: 'text-level-information',
  HEAD: 'text-level-information',
  OPTIONS: 'text-fg-muted',
  POST: 'text-accent',
  PUT: 'text-level-warning',
  PATCH: 'text-level-warning',
  DELETE: 'text-level-error',
}

/**
 * What one operation is called: the verb and its route, or the message template for the groups
 * that are not routes at all (jobs, probes, anything an app logged without a path).
 *
 * The verb is coloured text rather than a plate: a table column of plates is a column of boxes,
 * and the verb is already short enough to read as a word.
 */
export function OperationName({
  operation,
  className = '',
}: {
  operation: Pick<OperationOverview, 'template' | 'method' | 'route'>
  className?: string
}) {
  if (!operation.route) {
    return <span className={`truncate font-mono ${className}`}>{operation.template}</span>
  }
  return (
    <span className={`flex min-w-0 items-baseline gap-2 ${className}`}>
      {operation.method && (
        <span
          className={`shrink-0 font-mono text-xs font-semibold ${
            METHOD_CLASS[operation.method.toUpperCase()] ?? 'text-fg-muted'
          }`}
        >
          {operation.method}
        </span>
      )}
      <span className="truncate font-mono">{operation.route}</span>
    </span>
  )
}
