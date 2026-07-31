import type { Level } from '../types'
import { LEVELS, LEVEL_HEX } from '../lib/levels'
import { SeriesChip } from './ui/SeriesChip'

interface LevelChipsProps {
  activeLevels: ReadonlySet<Level>
  onToggle: (level: Level) => void
}

/**
 * The level filter, in the same chip every other legend on every other page uses.
 *
 * They were bare words until 2026-07-31, which is what a label looks like, not a control — the
 * only way to find out they filtered was to click one. The hue is the level's own, because
 * this chip names a level rather than drawing it: a chart draws Information neutral, a chip
 * that says "Information" does not.
 */
export function LevelChips({ activeLevels, onToggle }: LevelChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LEVELS.map((level) => (
        <SeriesChip
          key={level}
          color={LEVEL_HEX[level]}
          label={level}
          pressed={activeLevels.has(level)}
          dimmed={activeLevels.size > 0 && !activeLevels.has(level)}
          onClick={() => onToggle(level)}
        />
      ))}
    </div>
  )
}
