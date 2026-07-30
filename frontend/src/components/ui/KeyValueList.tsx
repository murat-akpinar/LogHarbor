import type { ReactNode } from 'react'

export interface KeyValueItem {
  label: string
  /** Machine text: set in mono by the row unless the caller passes its own element. */
  value: ReactNode
  /** A button or link that opens what the value only counts, e.g. "8 queries → View". */
  action?: ReactNode
}

/**
 * Label on the left, value on the right, a dotted rule carrying the eye across the gap.
 *
 * Detail panels are read by hunting for one field, not by reading top to bottom, and the
 * leader is what makes a long value line up with its own label instead of the one below it.
 */
export function KeyValueList({ items, className = '' }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={`flex flex-col gap-2 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-2">
          <dt className="shrink-0 text-xs tracking-wider text-fg-muted uppercase">{item.label}</dt>
          <span aria-hidden="true" className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-leader" />
          <dd className="tabular min-w-0 shrink truncate font-mono text-sm text-fg">{item.value}</dd>
          {item.action}
        </div>
      ))}
    </dl>
  )
}
