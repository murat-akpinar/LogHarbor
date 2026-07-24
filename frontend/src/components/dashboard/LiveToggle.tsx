import { useI18n } from '../../i18n'

interface LiveToggleProps {
  live: boolean
  onToggle: () => void
}

/** The pulse's signature control: a heartbeat dot that pings while live, still when paused. */
export function LiveToggle({ live, onToggle }: LiveToggleProps) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={live}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
        live
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'
      }`}
    >
      <span className="relative flex h-2.5 w-2.5 items-center justify-center">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live ? 'bg-accent' : 'bg-fg-muted'}`} />
      </span>
      {t.dashboard.live}
    </button>
  )
}
