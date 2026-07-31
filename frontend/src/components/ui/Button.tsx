import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

// The primary button is the one lit object in a form: it glows, and nothing else does, so the
// action you are meant to take is findable without reading the labels.
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-[0_0_20px_-6px_var(--color-accent)] hover:bg-accent-hover hover:shadow-[0_0_24px_-4px_var(--color-accent)]',
  secondary: 'border border-border-strong bg-surface text-fg hover:border-white/25 hover:bg-surface-hover',
  danger: 'text-level-error hover:bg-level-error/10',
  ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:opacity-50 disabled:shadow-none ${VARIANTS[variant]} ${className}`}
    />
  )
}
