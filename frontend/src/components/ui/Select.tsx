import type { ComponentPropsWithRef } from 'react'

export function Select({ className = '', ...rest }: ComponentPropsWithRef<'select'>) {
  return (
    <select
      {...rest}
      // the option list is drawn by the OS and cannot be made translucent, so it is told to
      // paint dark explicitly rather than inheriting a see-through background as white
      className={`rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg transition-all duration-200 hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none [&>option]:bg-[#0f1416] [&>option]:text-fg ${className}`}
    />
  )
}
