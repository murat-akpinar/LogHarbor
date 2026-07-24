// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { DashboardPage } from './DashboardPage'
import * as stats from '../api/stats'

const FIFTEEN_MIN_MS = 15 * 60 * 1000
const ISO = '2026-07-24T10:00:00.000Z'

const SUMMARY = {
  // Warning 57 is picked so it can't collide with the heatmap's 0-23 hour axis labels
  total: 200,
  byLevel: { Verbose: 0, Debug: 0, Information: 133, Warning: 57, Error: 10, Fatal: 10 },
}
const TOP_ERRORS = {
  errors: [{ template: 'Order {OrderId} failed', level: 'Error', count: 42, firstSeen: ISO, lastSeen: ISO }],
}
const TOP_EXCEPTIONS = {
  exceptions: [{ type: 'System.NullReferenceException', count: 12, firstSeen: ISO, lastSeen: ISO }],
}
const SERVICES = { services: [{ service: 'OrderService', total: 120, errorCount: 6, p95ElapsedMs: 250 }] }
const SLOW = {
  operations: [{ template: 'GET /orders', baselineP95: 100, currentP95: 400, count: 30 }],
  timedOperationCount: 5,
  comparableOperationCount: 5,
}

vi.mock('../api/stats', () => ({
  getSummary: vi.fn(async () => SUMMARY),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getHeatmap: vi.fn(async () => ({ cells: [] })),
  getTopErrors: vi.fn(async () => TOP_ERRORS),
  getTopExceptions: vi.fn(async () => TOP_EXCEPTIONS),
  getServices: vi.fn(async () => SERVICES),
  getSlowOperations: vi.fn(async () => SLOW),
}))

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('DashboardPage pulse', () => {
  it('derives the error rate and warning count from the summary', async () => {
    renderPage()
    // (Error 10 + Fatal 10) / total 200 = 10.0%
    expect(await screen.findByText('10.0%')).toBeDefined()
    expect(screen.getByText('57')).toBeDefined()
  })

  it('shows the top error and links its panel to Analysis', async () => {
    renderPage()
    expect(await screen.findByText('Order {OrderId} failed')).toBeDefined()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/analysis')
  })

  it('renders the service health and slowest-operation panels', async () => {
    renderPage()
    expect(await screen.findByText('OrderService')).toBeDefined()
    expect(await screen.findByText('GET /orders')).toBeDefined()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/services')
  })

  it('is live by default: shows the live control and hides the range picker', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Live' })).toBeDefined()
    expect(screen.queryByTitle('Time range')).toBeNull()
  })

  it('pausing live reveals the picker and narrows the queried window', async () => {
    renderPage()
    const live = await screen.findByRole('button', { name: 'Live' })
    live.click()

    const picker = await screen.findByTitle('Time range')
    picker.click()
    ;(await screen.findByText('Last 15 minutes')).click()

    // the last summary query must ask for a window no wider than 15 minutes
    const getSummary = vi.mocked(stats.getSummary)
    await waitFor(() => {
      const lastFrom = getSummary.mock.calls.at(-1)?.[0]?.from
      expect(lastFrom).toBeDefined()
      const width = Date.now() - new Date(lastFrom as string).getTime()
      expect(width).toBeLessThanOrEqual(FIFTEEN_MIN_MS + 60_000)
    })
  })
})
