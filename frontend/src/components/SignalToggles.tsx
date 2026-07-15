import { useSignals } from '../hooks/useSignals'

interface SignalTogglesProps {
  activeSignalIds: ReadonlySet<number>
  onToggle: (id: number) => void
}

export function SignalToggles({ activeSignalIds, onToggle }: SignalTogglesProps) {
  const { data: signals } = useSignals()

  if (!signals || signals.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {signals.map((signal) => {
        const isActive = activeSignalIds.has(signal.id)
        return (
          <button
            key={signal.id}
            type="button"
            onClick={() => onToggle(signal.id)}
            title={signal.filter}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ${
              isActive
                ? 'border border-accent/30 bg-accent/15 text-accent'
                : 'text-fg-muted hover:bg-surface-hover'
            }`}
          >
            {signal.title}
          </button>
        )
      })}
    </div>
  )
}
