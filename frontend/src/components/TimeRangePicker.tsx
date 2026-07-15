import { useState } from 'react'
import { isoToLocalInput, localInputToIso } from '../lib/dates'
import { Button } from './ui/Button'

interface TimeRangePickerProps {
  from: string | undefined
  to: string | undefined
  onChange: (range: { from: string | undefined; to: string | undefined }) => void
}

// what a log viewer actually reaches for; each is minutes back from "now" at click time
const PRESETS: [label: string, minutes: number][] = [
  ['Last 15 minutes', 15],
  ['Last hour', 60],
  ['Last 6 hours', 360],
  ['Last 24 hours', 1440],
  ['Last 7 days', 10080],
]

// ponytail: presets set an absolute `from` (frozen at click), matching the existing from/to
// query model — no rolling window. The preset label is a convenience and can drift as time
// passes; that's fine for a range shortcut.
function rangeLabel(from: string | undefined, to: string | undefined): string {
  if (!from && !to) return 'All time'
  if (from && !to) return `Since ${new Date(from).toLocaleString()}`
  if (!from && to) return `Until ${new Date(to).toLocaleString()}`
  return `${new Date(from!).toLocaleString()} – ${new Date(to!).toLocaleString()}`
}

const INPUT_CLASS =
  'rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none'

export function TimeRangePicker({ from, to, onChange }: TimeRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [preset, setPreset] = useState<string | null>(null)

  function applyPreset(label: string, minutes: number) {
    onChange({ from: new Date(Date.now() - minutes * 60_000).toISOString(), to: undefined })
    setPreset(label)
    setIsOpen(false)
  }

  function setCustom(range: { from: string | undefined; to: string | undefined }) {
    onChange(range)
    setPreset(null)
  }

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setIsOpen((open) => !open)} title="Time range">
        <span className="tabular">{preset ?? rangeLabel(from, to)}</span>
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-card border border-border bg-surface-raised p-2 text-sm shadow-card">
          {PRESETS.map(([label, minutes]) => (
            <button
              key={label}
              type="button"
              onClick={() => applyPreset(label, minutes)}
              className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover hover:text-fg ${
                preset === label ? 'text-accent' : 'text-fg-muted'
              }`}
            >
              {label}
            </button>
          ))}
          <div className="my-2 border-t border-border" />
          <div className="space-y-2 px-2 pb-1">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              From
              <input
                type="datetime-local"
                value={isoToLocalInput(from)}
                onChange={(event) => setCustom({ from: localInputToIso(event.target.value), to })}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              To
              <input
                type="datetime-local"
                value={isoToLocalInput(to)}
                onChange={(event) => setCustom({ from, to: localInputToIso(event.target.value) })}
                className={INPUT_CLASS}
              />
            </label>
          </div>
          {(from || to) && (
            <>
              <div className="my-2 border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  onChange({ from: undefined, to: undefined })
                  setPreset(null)
                  setIsOpen(false)
                }}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
              >
                Clear (all time)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
