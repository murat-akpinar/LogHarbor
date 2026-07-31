import type { ComponentPropsWithRef } from 'react'

interface InputProps extends ComponentPropsWithRef<'input'> {
  /** filter expressions, API keys and other machine text read better in the mono face */
  mono?: boolean
}

export function Input({ mono = false, className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      // a field is a well, not a plate: it is a hole you type into, so it goes darker than what
      // surrounds it and lights its edge only while it has the caret
      className={`rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg transition-all duration-200 placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${mono ? 'font-mono' : ''} ${className}`}
    />
  )
}
