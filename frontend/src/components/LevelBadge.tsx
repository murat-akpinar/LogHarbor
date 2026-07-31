import type { Level } from '../types'
import { LEVEL_CODE, LEVEL_HEX, LEVEL_TEXT } from '../lib/levels'

/**
 * A level, as three letters.
 *
 * Bare text in the event list, where ten thousand rows each carry one and a plate on every row
 * would be ten thousand plates. On a plate in the detail drawer, where there is exactly one and
 * it is the first thing the reader looks for — tinted in the level's own hue rather than merely
 * coloured, so it reads as a label instead of as a word that happens to be red.
 */
export function LevelBadge({ level, pill = false }: { level: Level; pill?: boolean }) {
  if (!pill) {
    return (
      <span className={`font-mono text-xs font-medium ${LEVEL_TEXT[level]}`} title={level}>
        {LEVEL_CODE[level]}
      </span>
    )
  }

  const hue = LEVEL_HEX[level]
  return (
    <span
      className="rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold"
      title={level}
      style={{
        color: hue,
        backgroundColor: `color-mix(in oklab, ${hue} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 32%, transparent)`,
      }}
    >
      {LEVEL_CODE[level]}
    </span>
  )
}
