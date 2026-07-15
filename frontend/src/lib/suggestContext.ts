const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_]*`
// property = 'value...  /  property <> 'value...  /  property like 'value...
const VALUE_CONTEXT = new RegExp(`(${IDENT})\\s*(?:=|<>|like)\\s*'([^']*)$`, 'i')
// start of input, after "(", or after whitespace: a bare identifier being typed
const PROPERTY_CONTEXT = new RegExp(`(?:^|[\\s(])(${IDENT})$`)

export type SuggestContext =
  | { mode: 'value'; property: string; prefix: string; replaceFrom: number }
  | { mode: 'property'; prefix: string; replaceFrom: number }

/** Only suggests bare structured properties (docs/query-language.md); @Level etc. have no stored values to look up. */
export function getSuggestContext(text: string, cursor: number): SuggestContext | null {
  const before = text.slice(0, cursor)

  const valueMatch = VALUE_CONTEXT.exec(before)
  if (valueMatch) {
    return {
      mode: 'value',
      property: valueMatch[1],
      prefix: valueMatch[2],
      replaceFrom: valueMatch.index + valueMatch[0].length - valueMatch[2].length,
    }
  }

  const propertyMatch = PROPERTY_CONTEXT.exec(before)
  if (propertyMatch && propertyMatch[1].length > 0) {
    return {
      mode: 'property',
      prefix: propertyMatch[1],
      replaceFrom: propertyMatch.index + propertyMatch[0].length - propertyMatch[1].length,
    }
  }

  return null
}
