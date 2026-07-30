import type { ReactNode } from 'react'

export type ChipTone = 'neutral' | 'error' | 'warning' | 'info' | 'accent' | 'violet'

const TONES: Record<ChipTone, string> = {
  neutral: 'bg-chip-bg text-fg-muted',
  error: 'bg-level-error/12 text-level-error',
  warning: 'bg-level-warning/12 text-level-warning',
  info: 'bg-level-information/12 text-level-information',
  accent: 'bg-accent/12 text-accent',
  violet: 'bg-level-verbose/12 text-level-verbose',
}

/**
 * A short machine word on a tinted plate: an HTTP method, a status code, a level, UNHANDLED.
 *
 * Mono and uppercase because every chip holds text the machine chose, not text we wrote. The
 * plate is the hue at low opacity rather than a border, so a row of chips reads as one texture
 * instead of a row of outlined boxes.
 */
export function Chip({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: ChipTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-xs tracking-wide uppercase ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
