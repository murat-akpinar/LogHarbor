// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getSlowOperations } from '../api/stats'
import { AnalysisPage } from './AnalysisPage'

const SLOW_OP = { template: 'Report query {Query} took {Elapsed} ms', baselineP95: 70, currentP95: 606, count: 88 }
const ONE_HOUR_MS = 60 * 60 * 1000

// mirrors the server: `from` splits baseline from current, so an operation whose history is
// younger than the selected range has no baseline and only regresses on a recent `from`
vi.mock('../api/stats', () => ({
  getTopErrors: vi.fn(async () => ({ errors: [] })),
  getTopExceptions: vi.fn(async () => ({ exceptions: [] })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getSlowOperations: vi.fn(async ({ from }: { from: string }) =>
    Date.now() - new Date(from).getTime() <= ONE_HOUR_MS
      ? { operations: [SLOW_OP], timedOperationCount: 1, comparableOperationCount: 1 }
      : { operations: [], timedOperationCount: 0, comparableOperationCount: 0 },
  ),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <AnalysisPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists a regression hidden by the default range once the 15-minute preset is picked', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  renderPage()
  // default 24h range: nothing to compare against that far back, so the table stays empty
  expect(screen.queryByText(SLOW_OP.template)).toBeNull()

  screen.getByTitle('Time range').click()
  ;(await screen.findByText('Last 15 minutes')).click()

  expect(await screen.findByText(SLOW_OP.template)).toBeDefined()
})

it('explains an empty card: no operation reports a duration', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue({ operations: [], timedOperationCount: 0, comparableOperationCount: 0 })
  renderPage()

  expect(await screen.findByText(/No operation reports an/)).toBeDefined()
})

it('explains an empty card: no baseline history to compare against', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue({ operations: [], timedOperationCount: 3, comparableOperationCount: 0 })
  renderPage()

  expect(await screen.findByText(/No operation has enough history/)).toBeDefined()
})

it('explains an empty card: comparable but nothing regressed', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue({ operations: [], timedOperationCount: 3, comparableOperationCount: 3 })
  renderPage()

  expect(await screen.findByText('No operations are slower than usual.')).toBeDefined()
})
