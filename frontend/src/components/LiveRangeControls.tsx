import type { TailStatus } from '../hooks/useLiveTail'
import { LiveToggle } from './LiveToggle'
import { TimeRangePicker } from './TimeRangePicker'

interface LiveRangeControlsProps {
  live: boolean
  onToggleLive: () => void
  from: string | undefined
  to: string | undefined
  onRangeChange: (range: { from: string | undefined; to: string | undefined }) => void
  /** Live tail only (Events): the SignalR connection state. */
  status?: TailStatus
}

/**
 * "When am I looking at?" — the same pair, in the same corner, on every page that has a
 * time dimension. Both controls stay visible in both states: picking a range drops out of
 * live mode instead of the picker appearing and shifting the row.
 */
export function LiveRangeControls({
  live,
  onToggleLive,
  from,
  to,
  onRangeChange,
  status,
}: LiveRangeControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <LiveToggle live={live} onToggle={onToggleLive} status={status} />
      <span aria-hidden className="select-none text-fg-subtle">
        |
      </span>
      <TimeRangePicker from={from} to={to} onChange={onRangeChange} />
    </div>
  )
}
