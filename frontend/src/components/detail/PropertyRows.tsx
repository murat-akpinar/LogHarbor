import type { Json } from '../JsonTree'
import { JsonTree } from '../JsonTree'
import { propertyEquals } from '../../lib/filter'
import { useI18n } from '../../i18n'
import { CopyButton } from './CopyButton'

interface PropertyRowsProps {
  properties: Record<string, Json>
  onFilter?: (filter: string) => void
}

function isScalar(value: Json): value is string | number | boolean {
  return value === null || typeof value !== 'object'
}

/** Flat rows for scalar properties (filter/copy per row); nested values keep the collapsible tree. */
export function PropertyRows({ properties, onFilter }: PropertyRowsProps) {
  const { t } = useI18n()
  const entries = Object.entries(properties)
  const scalars = entries.filter(([, value]) => isScalar(value))
  const nested = entries.filter(([, value]) => !isScalar(value))

  return (
    <div className="flex flex-col">
      {scalars.map(([key, value]) => {
        const text = value === null ? 'null' : String(value)
        return (
          <div key={key} className="group flex items-baseline gap-2 border-b border-border py-1 last:border-b-0">
            <span className="w-32 shrink-0 truncate font-mono text-xs text-fg-muted" title={key}>
              {key}
            </span>
            <span className="min-w-0 flex-1 break-words font-mono text-xs text-fg">{text}</span>
            <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {onFilter && value !== null && (
                <button
                  type="button"
                  onClick={() => onFilter(propertyEquals(key, text))}
                  aria-label={t.detail.filterBy(key)}
                  title={t.detail.filterBy(key)}
                  className="rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-accent"
                >
                  ⌕
                </button>
              )}
              <CopyButton value={text} />
            </span>
          </div>
        )
      })}
      {nested.length > 0 && (
        <div className="mt-2">
          <JsonTree value={Object.fromEntries(nested)} />
        </div>
      )}
    </div>
  )
}
