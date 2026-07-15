import type { ComponentPropsWithRef } from 'react'

export function Select({ className = '', ...rest }: ComponentPropsWithRef<'select'>) {
  return (
    <select
      {...rest}
      className={`rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none ${className}`}
    />
  )
}
