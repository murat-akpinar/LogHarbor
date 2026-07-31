// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { TimeRangeProvider } from '../hooks/useLiveRange'
import { getHistogram, getOperations } from '../api/stats'
import { RequestsPage } from './RequestsPage'

const EMPTY_COUNTS = { Verbose: 0, Debug: 0, Information: 0, Warning: 0, Error: 0, Fatal: 0 }

function bucketOf(count: number) {
  return { start: '2026-07-25T10:00:00.000Z', counts: { ...EMPTY_COUNTS, Information: count } }
}

vi.mock('../api/stats', () => ({
  getOperations: vi.fn(async () => ({
    operations: [
      { template: 'GET /api/orders/{id}', method: 'GET', route: '/api/orders/{id}', total: 90, errorCount: 0, p95ElapsedMs: 120, trend: [1, 4, 2] },
      { template: 'POST /api/orders', method: 'POST', route: '/api/orders', total: 10, errorCount: 5, p95ElapsedMs: 300, trend: [0, 1, 0] },
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

function renderPage(url = '/requests') {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TimeRangeProvider>
        <MemoryRouter initialEntries={[url]}>
          <RequestsPage />
        </MemoryRouter>
      </TimeRangeProvider>
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
  expect(await screen.findByText('/api/orders/{id}')).toBeDefined()
  // error % = 5 / 10 = 50.0%
  expect(screen.getByText('50.0%')).toBeDefined()
  expect(bodyRowTexts()[0]).toContain('GET')
  expect(bodyRowTexts()[0]).toContain('/api/orders/{id}')
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

// live on by default keeps the rolling hour honest: paused, the window froze at sign-in and
// a tab left open drifted hours behind with nothing on the page to say so
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
  await screen.findByText('/api/orders/{id}')

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

// the dashboard's request chart links here per status class; landing on the unfiltered table
// would throw away the thing the reader clicked
it('opens already narrowed when the URL names a status class', async () => {
  renderPage('/requests?status=server')

  await waitFor(() => {
    expect(vi.mocked(getOperations).mock.calls.some(([params]) => params.filter === 'StatusCode >= 500')).toBe(true)
  })
  expect(screen.getByRole('button', { name: /5xx/ }).getAttribute('aria-pressed')).toBe('true')
})

it('ignores a status class it does not know', async () => {
  renderPage('/requests?status=teapot')

  await screen.findByText('/api/orders/{id}')
  expect(screen.getByRole('button', { name: /5xx/ }).getAttribute('aria-pressed')).toBe('false')
})

it('re-sorts by error % when that header is clicked', async () => {
  renderPage()
  await screen.findByText('/api/orders/{id}')
  screen.getByRole('button', { name: 'Error %' }).click()
  await waitFor(() => {
    // the verb and the path are separate elements now, so the row text has no space between them
    expect(bodyRowTexts()[0]).toContain('POST')
    expect(bodyRowTexts()[1]).toContain('GET')
  })
})

// the trend column used to be one histogram request per row: fifty rows meant fifty round trips
// that could not start until getOperations had answered, and the table sat half-drawn until they
// landed. The strip comes down with the row now, so the only request this table makes is its own.
it('draws each row its trend without asking for one', async () => {
  renderPage()
  await screen.findByText('/api/orders/{id}')

  await waitFor(() => {
    expect(vi.mocked(getOperations).mock.calls.some(([params]) => params.trendBuckets === 24)).toBe(true)
  })

  // no row asked for a histogram of its own; the three that were requested are the status chart's
  const rowRequests = vi
    .mocked(getHistogram)
    .mock.calls.filter(([params]) => !params.filter?.includes('StatusCode'))
  expect(rowRequests).toHaveLength(0)

  // and the strip is actually drawn, one bar per bucket the row carried
  const strips = document.querySelectorAll('tbody [data-trend]')
  expect(strips).toHaveLength(2)
  expect(strips[0].children).toHaveLength(3)
})
