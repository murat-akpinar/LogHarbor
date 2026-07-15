import type { Level } from '../types'
import { LEVEL_CODE, LEVEL_TEXT } from '../lib/levels'

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className={`font-mono text-xs font-medium ${LEVEL_TEXT[level]}`} title={level}>
      {LEVEL_CODE[level]}
    </span>
  )
}
