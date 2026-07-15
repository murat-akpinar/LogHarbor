import type { Level } from '../types'
import { LEVEL_TEXT } from '../lib/levels'
import { Card } from './ui/Card'

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

interface StatTileProps {
  label: string
  value: number
  /** 'default' is the neutral total; a Level tints the figure with that level's colour */
  tone?: 'default' | Level
}

export function StatTile({ label, value, tone = 'default' }: StatTileProps) {
  const toneClass = tone === 'default' ? 'text-fg' : LEVEL_TEXT[tone]
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={`tabular text-2xl font-semibold ${toneClass}`}>{formatCompact(value)}</p>
    </Card>
  )
}
