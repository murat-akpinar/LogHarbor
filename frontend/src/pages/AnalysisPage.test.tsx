// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { TimeRangeProvider } from '../hooks/useLiveRange'
import { getSlowOperations } from '../api/stats'
import { AnalysisPage } from './AnalysisPage'

const SLOW_OP = { template: 'Report query {Query} took {Elapsed} ms', baselineP95: 70, currentP95: 606, count: 88 }
// half an hour, not an hour: the default window *is* the last hour, so a threshold of exactly
// one hour would decide this test on the milliseconds between the floored `from` and Date.now()
const RECENT_MS = 30 * 60 * 1000

// mirrors the server: `from` splits baseline from current, so an operation whose history is
// younger than the selected range has no baseline and only regresses on a recent `from`
vi.mock('../api/stats', () => ({
  getTopErrors: vi.fn(async () => ({ errors: [] })),
  getTopExceptions: vi.fn(async () => ({ exceptions: [] })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getSlowOperations: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    // the server's rule, mirrored: four windows of history, never more than a day
    const span = Math.min(4 * (new Date(to).getTime() - new Date(from).getTime()), 24 * 60 * 60 * 1000)
    const baselineFrom = new Date(new Date(from).getTime() - span).toISOString()
    return Date.now() - new Date(from).getTime() <= RECENT_MS
      ? { operations: [SLOW_OP], timedOperationCount: 1, comparableOperationCount: 1, baselineFrom }
      : { operations: [], timedOperationCount: 0, comparableOperationCount: 0, baselineFrom }
  }),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  // the tests below install their own answers; without a reset the last one to run keeps
  // answering, and the first test in this file depends on the mock above
  // (found 2026-08-01 by running the suite with --sequence.shuffle)
  vi.resetAllMocks()
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TimeRangeProvider>
        <MemoryRouter>
          <AnalysisPage />
        </MemoryRouter>
      </TimeRangeProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists a regression hidden by the default range once the 15-minute preset is picked', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  renderPage()
  // the default window is the last hour: nothing to compare against that far back, so
  // the table stays empty until the reader narrows it
  expect(screen.queryByText(SLOW_OP.template)).toBeNull()

  screen.getByTitle('Time range').click()
  ;(await screen.findByText('Last 15 minutes')).click()

  expect(await screen.findByText(SLOW_OP.template)).toBeDefined()
})

it('says what "usual" was measured over, since the server bounds it', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  renderPage()
  screen.getByTitle('Time range').click()
  ;(await screen.findByText('Last 15 minutes')).click()
  await screen.findByText(SLOW_OP.template)

  // four windows of fifteen minutes: the reader is told the hour, not left to guess that the
  // column means "before this range" and nothing more
  expect(screen.getByText(/“Usual” is the p95 over the 1 hour before this range\./)).toBeDefined()
})

it('explains an empty card: no operation reports a duration', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue(
    { operations: [], timedOperationCount: 0, comparableOperationCount: 0, baselineFrom: '2026-08-09T09:00:00.0000000Z' })
  renderPage()

  expect(await screen.findByText(/No operation reports an/)).toBeDefined()
})

it('explains an empty card: no baseline history to compare against', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue(
    { operations: [], timedOperationCount: 3, comparableOperationCount: 0, baselineFrom: '2026-08-09T09:00:00.0000000Z' })
  renderPage()

  expect(await screen.findByText(/No operation has enough history/)).toBeDefined()
})

it('explains an empty card: comparable but nothing regressed', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  vi.mocked(getSlowOperations).mockResolvedValue(
    { operations: [], timedOperationCount: 3, comparableOperationCount: 3, baselineFrom: '2026-08-09T09:00:00.0000000Z' })
  renderPage()

  expect(await screen.findByText('No operations are slower than usual.')).toBeDefined()
})
