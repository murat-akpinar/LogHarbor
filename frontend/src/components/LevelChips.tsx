import type { Level } from '../types'
import { LEVELS, LEVEL_TEXT } from '../lib/levels'

interface LevelChipsProps {
  activeLevels: ReadonlySet<Level>
  onToggle: (level: Level) => void
}

export function LevelChips({ activeLevels, onToggle }: LevelChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {LEVELS.map((level) => {
        const isActive = activeLevels.has(level)
        return (
          <button
            key={level}
            type="button"
            onClick={() => onToggle(level)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ${
              isActive
                ? `border border-border-strong bg-surface-raised ${LEVEL_TEXT[level]}`
                : 'text-fg-muted hover:bg-surface-hover'
            }`}
          >
            {level}
          </button>
        )
      })}
    </div>
  )
}
