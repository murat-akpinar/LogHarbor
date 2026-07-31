import type { TailStatus } from '../hooks/useLiveTail'
import { useI18n } from '../i18n'

const STATUS_DOT: Record<TailStatus, string> = {
  connected: 'bg-accent',
  connecting: 'bg-level-warning',
  disconnected: 'bg-level-error',
}

interface LiveToggleProps {
  live: boolean
  onToggle: () => void
  /** Live tail only: the SignalR connection state, which colours the dot. */
  status?: TailStatus
}

/** The pulse's signature control: a heartbeat dot that pings while live, still when paused. */
export function LiveToggle({ live, onToggle, status }: LiveToggleProps) {
  const { t } = useI18n()
  const dot = live ? (status ? STATUS_DOT[status] : 'bg-accent') : 'bg-fg-muted'
  // a socket that is not connected must not pretend to be alive
  const isPinging = live && (status ?? 'connected') === 'connected'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={live}
      title={live && status ? `${t.common.live}: ${t.events.tailStatus[status]}` : t.common.live}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
        live
          ? 'border-accent/40 bg-accent/12 text-accent shadow-[0_0_18px_-6px_var(--color-accent)]'
          : 'border-border bg-surface-inset text-fg-muted hover:border-border-strong hover:bg-surface-hover hover:text-fg'
      }`}
    >
      <span className="relative flex h-2.5 w-2.5 items-center justify-center">
        {isPinging && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
        )}
        {/* the dot is lit, not just filled: this is the control that says the page is alive */}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`}
          style={live ? { boxShadow: '0 0 8px 1px currentColor' } : undefined}
        />
      </span>
      {t.common.live}
    </button>
  )
}
