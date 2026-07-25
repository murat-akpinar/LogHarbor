// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getOperations } from '../api/stats'
import { RequestsPage } from './RequestsPage'

const EMPTY_COUNTS = { Verbose: 0, Debug: 0, Information: 0, Warning: 0, Error: 0, Fatal: 0 }

function bucketOf(count: number) {
  return { start: '2026-07-25T10:00:00.000Z', counts: { ...EMPTY_COUNTS, Information: count } }
}

vi.mock('../api/stats', () => ({
  getOperations: vi.fn(async () => ({
    operations: [
      { template: 'GET /api/orders/{id}', total: 90, errorCount: 0, p95ElapsedMs: 120 },
      { template: 'POST /api/orders', total: 10, errorCount: 5, p95ElapsedMs: 300 },
    ],
  })),
  getHistogram: vi.fn(async ({ filter }: { filter?: string }) => {
    if (filter?.includes('StatusCode >= 500')) return { buckets: [bucketOf(4)] }
    if (filter?.includes('StatusCode >= 400')) return { buckets: [bucketOf(6)] }
    if (filter?.includes('StatusCode <')) return { buckets: [bucketOf(90)] }
    return { buckets: [] } // row sparklines
  }),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <RequestsPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

function bodyRowTexts(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1) // skip the header row
    .map((row) => row.textContent ?? '')
}

it('lists operations with their RED numbers, busiest first', async () => {
  renderPage()
  expect(await screen.findByText('GET /api/orders/{id}')).toBeDefined()
  // error % = 5 / 10 = 50.0%
  expect(screen.getByText('50.0%')).toBeDefined()
  expect(bodyRowTexts()[0]).toContain('GET /api/orders/{id}')
})

it('stacks status-class series with their totals in the legend', async () => {
  renderPage()
  expect(await screen.findByText('1/2/3xx')).toBeDefined()
  expect(screen.getByText('4xx')).toBeDefined()
  expect(screen.getByText('5xx')).toBeDefined()
  // legend totals per class
  expect(await screen.findByText('90')).toBeDefined()
  expect(screen.getByText('6')).toBeDefined()
  expect(screen.getByText('4')).toBeDefined()
})

it('starts live, and keeps the range picker alongside in both states', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  // the pair is one control group: the picker never appears or vanishes under the cursor
  expect(screen.getByTitle('Time range')).toBeDefined()

  toggle.click()
  await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
  expect(screen.getByTitle('Time range')).toBeDefined()
})

it('isolates a status class and narrows the table to it', async () => {
  renderPage()
  await screen.findByText('GET /api/orders/{id}')

  const only5xx = screen.getByRole('button', { name: /5xx/ })
  only5xx.click()
  await waitFor(() => {
    expect(vi.mocked(getOperations).mock.calls.some(([params]) => params.filter === 'StatusCode >= 500')).toBe(true)
  })
  await waitFor(() => expect(only5xx.getAttribute('aria-pressed')).toBe('true'))

  // clicking again returns to every class
  only5xx.click()
  await waitFor(() => expect(only5xx.getAttribute('aria-pressed')).toBe('false'))
})

it('re-sorts by error % when that header is clicked', async () => {
  renderPage()
  await screen.findByText('GET /api/orders/{id}')
  screen.getByRole('button', { name: 'Error %' }).click()
  await waitFor(() => {
    expect(bodyRowTexts()[0]).toContain('POST /api/orders')
  })
})
