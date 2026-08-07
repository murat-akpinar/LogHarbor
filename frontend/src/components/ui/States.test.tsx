// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../i18n'
import { EmptyState, ErrorState, TableSkeletonBody } from './States'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderInEnglish(node: React.ReactNode) {
  localStorage.setItem('logharbor-lang', 'en')
  render(<LanguageProvider>{node}</LanguageProvider>)
}

// a failed panel used to print its message and stay dead until the reader guessed to reload
it('offers a way to retry a failed request', () => {
  const retry = vi.fn()
  renderInEnglish(<ErrorState message="Database is locked" onRetry={retry} />)

  expect(screen.getByRole('alert').textContent).toContain('Database is locked')
  screen.getByRole('button', { name: 'Try again' }).click()
  expect(retry).toHaveBeenCalledTimes(1)
})

it('offers no button where there is nothing to retry', () => {
  renderInEnglish(<ErrorState message="Database is locked" />)

  expect(screen.queryByRole('button')).toBeNull()
})

it('says what is empty and why', () => {
  renderInEnglish(<EmptyState title="No queries" description="Nothing here logged a SQL statement." />)

  expect(screen.getByText('No queries')).toBeDefined()
  expect(screen.getByText('Nothing here logged a SQL statement.')).toBeDefined()
})

it('draws the skeleton in the shape of the table it stands in', () => {
  render(
    <table>
      <TableSkeletonBody columns={4} rows={3} />
    </table>,
  )

  expect(document.querySelectorAll('[data-skeleton] tr')).toHaveLength(3)
  expect(document.querySelectorAll('[data-skeleton] td')).toHaveLength(12)
  // one animated element per table, not one per cell: test/perf-check counts these
  expect(document.querySelectorAll('.animate-pulse')).toHaveLength(1)
})
