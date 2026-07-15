import { useState } from 'react'
import { isoToLocalInput, localInputToIso } from '../lib/dates'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

interface TimeRangePickerProps {
  from: string | undefined
  to: string | undefined
  onChange: (range: { from: string | undefined; to: string | undefined }) => void
}

type PresetKey = 'last15m' | 'lastHour' | 'last6h' | 'last24h' | 'last7d'

// what a log viewer actually reaches for; each is minutes back from "now" at click time
const PRESETS: { key: PresetKey; minutes: number }[] = [
  { key: 'last15m', minutes: 15 },
  { key: 'lastHour', minutes: 60 },
  { key: 'last6h', minutes: 360 },
  { key: 'last24h', minutes: 1440 },
  { key: 'last7d', minutes: 10080 },
]

const INPUT_CLASS =
  'rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none'

export function TimeRangePicker({ from, to, onChange }: TimeRangePickerProps) {
  const { t, lang } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [presetKey, setPresetKey] = useState<PresetKey | null>(null)

  // ponytail: presets set an absolute `from` (frozen at click), matching the existing from/to
  // query model — no rolling window. The preset label is a convenience and can drift as time
  // passes; that's fine for a range shortcut.
  function rangeLabel(): string {
    if (!from && !to) return t.timeRange.allTime
    if (from && !to) return t.timeRange.since(new Date(from).toLocaleString(lang))
    if (!from && to) return t.timeRange.until(new Date(to).toLocaleString(lang))
    return `${new Date(from!).toLocaleString(lang)} – ${new Date(to!).toLocaleString(lang)}`
  }

  function applyPreset(key: PresetKey, minutes: number) {
    onChange({ from: new Date(Date.now() - minutes * 60_000).toISOString(), to: undefined })
    setPresetKey(key)
    setIsOpen(false)
  }

  function setCustom(range: { from: string | undefined; to: string | undefined }) {
    onChange(range)
    setPresetKey(null)
  }

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setIsOpen((open) => !open)} title={t.timeRange.title}>
        <span className="tabular">{presetKey ? t.timeRange[presetKey] : rangeLabel()}</span>
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-card border border-border bg-surface-raised p-2 text-sm shadow-card">
          {PRESETS.map(({ key, minutes }) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key, minutes)}
              className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover hover:text-fg ${
                presetKey === key ? 'text-accent' : 'text-fg-muted'
              }`}
            >
              {t.timeRange[key]}
            </button>
          ))}
          <div className="my-2 border-t border-border" />
          <div className="space-y-2 px-2 pb-1">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t.timeRange.from}
              <input
                type="datetime-local"
                value={isoToLocalInput(from)}
                onChange={(event) => setCustom({ from: localInputToIso(event.target.value), to })}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t.timeRange.to}
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
                  setPresetKey(null)
                  setIsOpen(false)
                }}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
              >
                {t.timeRange.clear}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
