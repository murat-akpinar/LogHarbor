// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SqlText } from './SqlText'

afterEach(cleanup)

function spanFor(container: HTMLElement, text: string): HTMLElement | undefined {
  return [...container.querySelectorAll('span')].find((span) => span.textContent === text)
}

it('reproduces the statement character for character', () => {
  const sql = "UPDATE users SET name = 'O''Brien', seen = @p0 WHERE id IN (1, 2)  -- keep"
  const { container } = render(<SqlText text={sql} />)
  expect(container.textContent).toBe(sql)
})

it('tells reads, writes and schema changes apart by colour', () => {
  const { container } = render(<SqlText text="SELECT 1" />)
  const { container: write } = render(<SqlText text="DELETE FROM t" />)
  const { container: ddl } = render(<SqlText text="DROP TABLE t" />)

  const read = spanFor(container, 'SELECT')?.className
  const deleted = spanFor(write, 'DELETE')?.className
  const dropped = spanFor(ddl, 'DROP')?.className

  expect(read).toContain('text-level-information')
  expect(deleted).toContain('text-level-warning')
  expect(dropped).toContain('text-level-error')
  expect(new Set([read, deleted, dropped]).size).toBe(3)
})

// the trap: a literal that happens to contain a verb is data, not a statement, and colouring it
// would claim this query deletes something when it only mentions the word
it('leaves keywords inside a string literal alone', () => {
  const { container } = render(<SqlText text="SELECT 'DELETE pending' AS note" />)
  expect(spanFor(container, 'DELETE')).toBeUndefined()
  expect(spanFor(container, "'DELETE pending'")?.className).toContain('text-accent')
})
