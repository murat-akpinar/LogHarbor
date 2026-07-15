import type { ReactNode } from 'react'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface HighlightedProps {
  text: string
  terms: string[]
}

/** Wraps term matches in <mark>, built from React text nodes (never innerHTML) since log content is untrusted. */
export function Highlighted({ text, terms }: HighlightedProps): ReactNode {
  const nonEmptyTerms = terms.filter((term) => term.length > 0)
  if (nonEmptyTerms.length === 0) {
    return text
  }
  const pattern = new RegExp(`(${nonEmptyTerms.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return parts.map((part, index) =>
    nonEmptyTerms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
      <mark key={index} className="rounded-[3px] bg-accent/25 px-0.5 text-fg">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
