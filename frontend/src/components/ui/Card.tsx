import type { CSSProperties, ReactNode } from 'react'

/**
 * plate  — a free-standing object on the canvas: translucent, blurred, edged with a hairline.
 * lifted — the same, with the heavier shadow, for the one card a screen is built around.
 * float  — a tooltip or popover. Nearly opaque, and that is the point: a readout you can see
 *          the chart through is a readout you have to squint at, which is exactly what the
 *          owner reported on 2026-07-31. Dropdowns already used this bed; the hover readouts
 *          over the charts had been left on the translucent one.
 */
type Variant = 'plate' | 'lifted' | 'float'

const VARIANTS: Record<Variant, string> = {
  plate: 'bg-surface shadow-card',
  lifted: 'bg-surface shadow-pop',
  float: 'bg-surface-float shadow-pop',
}

export function Card({
  children,
  className = '',
  variant = 'plate',
  style,
}: {
  children: ReactNode
  className?: string
  variant?: Variant
  /** Carries the entrance delay a caller staggers a row of plates with, as Panel does. */
  style?: CSSProperties
}) {
  return (
    <div style={style} className={`glass rounded-card border border-border ${VARIANTS[variant]} ${className}`}>
      {children}
    </div>
  )
}
