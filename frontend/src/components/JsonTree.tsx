export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const KEY_CLASS = 'text-fg-muted'

function Primitive({ value }: { value: string | number | boolean | null }) {
  if (value === null) {
    return <span className="text-fg-subtle">null</span>
  }
  if (typeof value === 'string') {
    return <span className="break-all text-fg">"{value}"</span>
  }
  return <span className="text-accent">{String(value)}</span>
}

function Entry({ name, value }: { name: string; value: Json }) {
  if (value === null || typeof value !== 'object') {
    return (
      <div className="py-0.5">
        <span className={KEY_CLASS}>{name}</span>
        <span className="text-fg-subtle">: </span>
        <Primitive value={value} />
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)
  return (
    <details className="py-0.5">
      <summary className="cursor-pointer">
        <span className={KEY_CLASS}>{name}</span>
        <span className="text-fg-subtle">
          {' '}
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </summary>
      <div className="ml-2 border-l border-border pl-3">
        {entries.map(([key, child]) => (
          <Entry key={key} name={key} value={child} />
        ))}
      </div>
    </details>
  )
}

/** Syntax-highlighted JSON tree; nested objects/arrays collapse via native details/summary. */
export function JsonTree({ value }: { value: Record<string, Json> }) {
  return (
    <div className="font-mono text-xs">
      {Object.entries(value).map(([key, child]) => (
        <Entry key={key} name={key} value={child} />
      ))}
    </div>
  )
}
