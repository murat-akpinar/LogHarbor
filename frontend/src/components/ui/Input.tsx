import type { ComponentPropsWithRef } from 'react'

interface InputProps extends ComponentPropsWithRef<'input'> {
  /** filter expressions, API keys and other machine text read better in the mono face */
  mono?: boolean
}

export function Input({ mono = false, className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={`rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg transition-colors duration-150 placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none ${mono ? 'font-mono' : ''} ${className}`}
    />
  )
}
