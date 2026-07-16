// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { DashboardPage } from './DashboardPage'

const ONE_HOUR_MS = 60 * 60 * 1000
const EMPTY_LEVELS = { Verbose: 0, Debug: 0, Information: 0, Warning: 0, Error: 0, Fatal: 0 }

// a narrow range must reach the API as a narrow range: recent `from` -> 7 events, wider -> 1000
vi.mock('../api/stats', () => ({
  getSummary: vi.fn(async ({ from }: { from: string }) => ({
    total: Date.now() - new Date(from).getTime() <= ONE_HOUR_MS ? 7 : 1000,
    byLevel: EMPTY_LEVELS,
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getHeatmap: vi.fn(async () => ({ cells: [] })),
  getTopErrors: vi.fn(async () => ({ errors: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it('narrows the queried range when the 15-minute preset is picked', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('1K')).toBeDefined()

  screen.getByTitle('Time range').click()
  ;(await screen.findByText('Last 15 minutes')).click()

  expect(await screen.findByText('7')).toBeDefined()
})
