import { useCallback, useRef, useState } from 'react'
import { isoToLocalInput, localInputToIso } from '../lib/dates'
import { useDismiss } from '../hooks/useDismiss'
import { PRESETS } from '../lib/timeRange'
import type { PresetKey } from '../lib/timeRange'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

interface TimeRangePickerProps {
  from: string | undefined
  to: string | undefined
  /** Which preset the shared window is on, if any — see hooks/useLiveRange. */
  presetKey: PresetKey | null
  onChange: (range: { from: string | undefined; to: string | undefined }) => void
  onPreset: (key: PresetKey) => void
}

const INPUT_CLASS =
  'rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none'

export function TimeRangePicker({ from, to, presetKey, onChange, onPreset }: TimeRangePickerProps) {
  const { t, lang } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setIsOpen(false), [])
  useDismiss(isOpen, anchorRef, close)

  // Both the preset and the two dates come from the shared window, not from state in here: a
  // preset picked on one page has to still read "Last 6 hours" on the next one. It also has to
  // still *be* the last six hours, which is why a preset rolls rather than recording two dates
  // at the moment it was clicked — the label used to drift away from the window it named.
  function rangeLabel(): string {
    if (!from && !to) return t.timeRange.allTime
    if (from && !to) return t.timeRange.since(new Date(from).toLocaleString(lang))
    if (!from && to) return t.timeRange.until(new Date(to).toLocaleString(lang))
    return `${new Date(from!).toLocaleString(lang)} – ${new Date(to!).toLocaleString(lang)}`
  }

  function applyPreset(key: PresetKey) {
    onPreset(key)
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={anchorRef}>
      <Button variant="secondary" onClick={() => setIsOpen((open) => !open)} title={t.timeRange.title}>
        <span className="tabular">{presetKey ? t.timeRange[presetKey] : rangeLabel()}</span>
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 glass rounded-card border border-border bg-surface-float p-2 text-sm shadow-pop">
          {PRESETS.map(({ key }) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
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
                onChange={(event) => onChange({ from: localInputToIso(event.target.value), to })}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t.timeRange.to}
              <input
                type="datetime-local"
                value={isoToLocalInput(to)}
                onChange={(event) => onChange({ from, to: localInputToIso(event.target.value) })}
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
