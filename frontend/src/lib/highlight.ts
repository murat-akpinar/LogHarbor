const COMPARISON_OPERATORS = new Set(['=', '<>', '<', '<=', '>', '>=', 'like'])

/**
 * Extracts quoted string literals from a filter expression that represent free-text
 * or `contains` terms (docs/frontend.md search term highlight). A literal used on
 * either side of =, <>, <, <=, >, >= or `like` is a structured comparison value, not
 * text to highlight, so it's excluded. This is a heuristic over the raw filter text,
 * not a full parse — good enough for client-side highlighting.
 */
export function extractHighlightTerms(filter: string): string[] {
  const terms: string[] = []
  const stringLiteral = /'((?:[^']|'')*)'/g
  let match: RegExpExecArray | null
  while ((match = stringLiteral.exec(filter)) !== null) {
    const before = filter.slice(0, match.index).trimEnd()
    const precedingWord = before.split(/[\s()]+/).filter(Boolean).pop()?.toLowerCase()
    if (precedingWord === undefined || !COMPARISON_OPERATORS.has(precedingWord)) {
      terms.push(match[1].replace(/''/g, "'"))
    }
  }
  return terms
}
