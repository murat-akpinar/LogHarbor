import type { TailStatus } from '../hooks/useLiveTail'
import { useI18n } from '../i18n'

const STATUS_DOT: Record<TailStatus, string> = {
  connected: 'bg-accent',
  connecting: 'bg-level-warning animate-pulse',
  disconnected: 'bg-level-error',
}

interface LiveTailToggleProps {
  isLive: boolean
  status: TailStatus
  onToggle: () => void
}

export function LiveTailToggle({ isLive, status, onToggle }: LiveTailToggleProps) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isLive}
      title={isLive ? `${t.events.liveTail}: ${t.events.tailStatus[status]}` : t.events.liveTail}
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ${
        isLive ? 'text-accent' : 'text-fg-muted hover:bg-surface-hover'
      }`}
    >
      <span className={`size-1.5 rounded-full ${isLive ? STATUS_DOT[status] : 'bg-fg-muted'}`} aria-hidden="true" />
      {t.events.liveTail}
    </button>
  )
}
