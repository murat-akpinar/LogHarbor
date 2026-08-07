import type { ReactNode } from 'react'
import { Button } from './Button'
import { PageIcon } from '../icons'
import type { PageIconName } from '../icons'
import { useI18n } from '../../i18n'

/**
 * The three things a panel says when it is not showing data, in one place.
 *
 * They were written per page before, which made them the least looked-at pixels in the
 * product: a failed panel printed its message and stayed dead until the reader guessed to
 * reload, and a loading table and an empty table looked exactly alike — both were nothing at
 * all, and React Query's retries hold that state for seconds.
 *
 * The words stay per page. Only the shape is shared.
 */

/**
 * A request that failed, and the one action worth offering.
 *
 * The message is the server's own ProblemDetails detail wherever there is one, because "could
 * not load" tells an operator nothing that the reason would not have told them better.
 */
export function ErrorState({
  message,
  onRetry,
  className = '',
}: {
  message: string
  /** Wired to the query's refetch. Left out where nothing can be retried. */
  onRetry?: () => void
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg bg-level-error/10 p-3 text-sm text-level-error ${className}`}
    >
      <span className="min-w-0">{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="shrink-0">
          {t.common.retry}
        </Button>
      )}
    </div>
  )
}

/**
 * Nothing to show, said in the middle of the space the data would have filled.
 *
 * Centred rather than a line of text in the top-left corner: an empty well with one sentence
 * tucked into its corner reads as a table that failed to draw its first row.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}: {
  title: string
  description?: string
  icon?: PageIconName
  /** A way out of the empty state — a link to the page that would fill it, say. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center gap-1.5 px-4 py-10 text-center ${className}`}>
      {icon && <PageIcon name={icon} className="size-5 text-fg-subtle" />}
      <p className="text-sm text-fg-muted">{title}</p>
      {description && <p className="max-w-md text-xs text-fg-subtle">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** One bar of the shape content will have. Sized by the caller.
 *  data-skeleton is the handle tests hold it by, the way data-trend is on Sparkline: it is
 *  hidden from the accessibility tree, so there is nothing else to find it with. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div data-skeleton className={`animate-pulse rounded bg-fg/10 ${className}`} aria-hidden="true" />
}

// A row of cells reads as a row of content when the first cell is long and the rest are not —
// a grid of equal blocks reads as a grid. Cycled per row so no two rows are identical.
const CELL_WIDTHS = ['70%', '45%', '55%', '38%', '62%', '50%']

/**
 * The table body, in the shape of the rows that are coming.
 *
 * A whole tbody rather than rows a caller drops into its own: the pulse then belongs to one
 * element per table instead of one per cell, and this app counts how many things animate at
 * once (test/perf-check).
 */
export function TableSkeletonBody({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <tbody data-skeleton className="animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="border-b border-border last:border-b-0">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-3 py-3">
              <div
                className="h-3 rounded bg-fg/10"
                style={{ width: CELL_WIDTHS[(row + column) % CELL_WIDTHS.length] }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
