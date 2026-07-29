/**
 * SQL text with its keywords coloured. The point is not decoration: the verb tells you whether
 * a statement reads, writes or changes the schema, and that is the first thing you want to know
 * when a query shows up in a slow list. Verbs carry the level hues (read = blue, write = amber,
 * DDL = red), clauses stay quiet, values get their own hue.
 *
 * Query text is log content, so it is rendered as React text nodes only — never as HTML.
 */

const READ = new Set(['SELECT', 'WITH'])
const WRITE = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'UPSERT'])
const DDL = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE'])
const CLAUSE = new Set([
  'ALL', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE', 'CROSS', 'DESC', 'DISTINCT', 'ELSE', 'END',
  'EXISTS', 'FETCH', 'FROM', 'FULL', 'GROUP', 'HAVING', 'IN', 'INNER', 'INTO', 'IS', 'JOIN',
  'LEFT', 'LIKE', 'LIMIT', 'NEXT', 'NOT', 'NULL', 'OFFSET', 'ON', 'ONLY', 'OR', 'ORDER', 'OUTER',
  'RETURNING', 'RIGHT', 'ROWS', 'SET', 'THEN', 'TOP', 'UNION', 'USING', 'VALUES', 'WHEN', 'WHERE',
])

// one pass: quoted literals (SQL doubles a quote to escape it), bracketed/backticked identifiers,
// bind parameters in the @p0 / :name / $1 spellings, numbers, then bare words
const TOKEN =
  /'(?:[^']|'')*'|"[^"]*"|`[^`]*`|\[[^\]]*\]|[@:$][A-Za-z_]\w*|\?|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*/g

const CLASS = {
  read: 'text-level-information font-medium',
  write: 'text-level-warning font-medium',
  ddl: 'text-level-error font-medium',
  clause: 'text-level-verbose',
  string: 'text-accent',
  value: 'text-level-debug',
  plain: '',
} as const

type Kind = keyof typeof CLASS

function classify(token: string): Kind {
  const first = token[0]
  if (first === "'" || first === '"') return 'string'
  if (first === '`' || first === '[') return 'plain'
  if (first === '@' || first === ':' || first === '$' || token === '?') return 'value'
  if (first >= '0' && first <= '9') return 'value'

  const word = token.toUpperCase()
  if (READ.has(word)) return 'read'
  if (WRITE.has(word)) return 'write'
  if (DDL.has(word)) return 'ddl'
  if (CLAUSE.has(word)) return 'clause'
  return 'plain'
}

export function SqlText({ text }: { text: string }) {
  const parts: { text: string; kind: Kind }[] = []
  let cursor = 0

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), kind: 'plain' })
    }
    parts.push({ text: match[0], kind: classify(match[0]) })
    cursor = start + match[0].length
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), kind: 'plain' })
  }

  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'plain' ? (
          part.text
        ) : (
          <span key={index} className={CLASS[part.kind]}>
            {part.text}
          </span>
        ),
      )}
    </>
  )
}
