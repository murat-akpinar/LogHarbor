// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { TimeRangeProvider } from '../hooks/useLiveRange'
import { getHistogram, getOperations, getPropertyValues } from '../api/stats'
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
      // a failure logged with the path and the status and no verb: a route row with no method
      { template: '/api/checkout', method: null, route: '/api/checkout', total: 4, errorCount: 4, p95ElapsedMs: null, trend: [0, 2, 2] },
    ],
  })),
  getHistogram: vi.fn(async ({ filter }: { filter?: string }) => {
    if (filter === 'StatusCode = 502') return { buckets: [bucketOf(3)] }
    if (filter?.includes('StatusCode >= 500')) return { buckets: [bucketOf(4)] }
    if (filter?.includes('StatusCode >= 400')) return { buckets: [bucketOf(6)] }
    if (filter?.includes('StatusCode <')) return { buckets: [bucketOf(88)] }
    return { buckets: [] } // row sparklines
  }),
  // deliberately unsorted, and summing to the class totals above: 88 / 6 / 4
  getPropertyValues: vi.fn(async () => ({
    values: [
      { value: '502', count: 3 },
      { value: '200', count: 80 },
      { value: '404', count: 5 },
      { value: '204', count: 8 },
      { value: '429', count: 1 },
      { value: '500', count: 1 },
    ],
  })),
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
  expect(await screen.findByText('88')).toBeDefined()
  expect(screen.getByText('6')).toBeDefined()
  expect(screen.getByText('4')).toBeDefined()
})

// the classes cannot answer "which 5xx": 500, 502 and 503 are three different mornings and a
// class chip paints them one red. The breakdown is the whole point of the section's own title.
it('breaks the range down by exact status code, lowest first', async () => {
  renderPage()
  await screen.findByText('502')

  expect(vi.mocked(getPropertyValues).mock.calls.some(([params]) => params.property === 'StatusCode')).toBe(true)

  const codes = screen
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((text) => /^\d{3}/.test(text))
  expect(codes).toEqual(['20080', '2048', '4045', '4291', '5001', '5023'])
})

it('narrows the table and the chart to one status code', async () => {
  renderPage()
  const only502 = await screen.findByRole('button', { name: /502/ })
  only502.click()

  await waitFor(() => {
    expect(vi.mocked(getOperations).mock.calls.some(([params]) => params.filter === 'StatusCode = 502')).toBe(true)
  })
  // and the chart draws that code's own shape, not its class's
  expect(vi.mocked(getHistogram).mock.calls.some(([params]) => params.filter === 'StatusCode = 502')).toBe(true)
  await waitFor(() => expect(only502.getAttribute('aria-pressed')).toBe('true'))

  // the class chip stays a way back up to every 5xx
  expect(screen.getByRole('button', { name: /5xx/ }).getAttribute('aria-pressed')).toBe('false')
})

// the requests that fail are logged by an exception handler that has a path and no verb. They
// reach their route now, and the row has to say so without inventing a method.
it('shows a route row that carries no verb', async () => {
  renderPage()
  expect(await screen.findByText('/api/checkout')).toBeDefined()
  const row = bodyRowTexts().find((text) => text.includes('/api/checkout')) ?? ''
  expect(row).toContain('100.0%')
  expect(row).not.toMatch(/GET|POST|PUT|DELETE/)
})

// opens live on the rolling last hour — pausing is the deliberate act, not starting the stream
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

// "still loading" and "nothing here" used to look identical -- both were an empty table -- and
// React Query holds that state for seconds while it retries
it('draws a skeleton while the table is still loading, and the empty line only when it is empty', async () => {
  let land: (value: { operations: [] }) => void = () => {}
  vi.mocked(getOperations).mockImplementationOnce(() => new Promise((resolve) => { land = resolve }))
  renderPage()

  const emptyLine = /No operations with a message template/
  await waitFor(() => expect(document.querySelector('tbody[data-skeleton]')).not.toBeNull())
  expect(screen.queryByText(emptyLine)).toBeNull()

  land({ operations: [] })
  expect(await screen.findByText(emptyLine)).toBeDefined()
  expect(document.querySelector('tbody[data-skeleton]')).toBeNull()
})

it('offers a retry when the table request fails, and asks again on click', async () => {
  vi.mocked(getOperations).mockRejectedValueOnce(new Error('Database is locked'))
  renderPage()

  expect(await screen.findByText('Database is locked')).toBeDefined()
  const calls = vi.mocked(getOperations).mock.calls.length
  screen.getByRole('button', { name: 'Try again' }).click()
  await waitFor(() => expect(vi.mocked(getOperations).mock.calls.length).toBeGreaterThan(calls))
})

it('re-sorts by error % when that header is clicked', async () => {
  renderPage()
  await screen.findByText('/api/orders/{id}')
  screen.getByRole('button', { name: 'Error %' }).click()
  await waitFor(() => {
    // 100% (the verbless failure row), then 50%, then the healthy one. The verb and the path are
    // separate elements now, so the row text has no space between them.
    expect(bodyRowTexts()[0]).toContain('/api/checkout')
    expect(bodyRowTexts()[1]).toContain('POST')
    expect(bodyRowTexts()[2]).toContain('GET')
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
  expect(strips).toHaveLength(3)
  expect(strips[0].children).toHaveLength(3)
})
