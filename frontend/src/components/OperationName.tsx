import type { OperationOverview } from '../types'

/** The verb decides the colour, so a write standing out among reads is visible before reading
 *  a single path. Level hues, so both themes and their contrast floor still hold. */
export const METHOD_CLASS: Record<string, string> = {
  GET: 'text-level-information',
  HEAD: 'text-level-information',
  OPTIONS: 'text-fg-muted',
  POST: 'text-accent',
  PUT: 'text-level-verbose',
  PATCH: 'text-level-verbose',
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
