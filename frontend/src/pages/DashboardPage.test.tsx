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
  // Warning 57 can't collide with the heatmap's 0-23 hour axis labels
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
const OPERATIONS = {
  operations: [
    { template: 'GET /articles', method: 'GET', route: '/articles', total: 90, errorCount: 2, p95ElapsedMs: 512 },
  ],
}
const USERS = { users: [{ value: 'user-7', total: 33, errorCount: 3, lastSeen: ISO }] }

const LAG = {
  lateAfterSeconds: 60,
  lag: {
    total: 200, lateCount: 3, skewedCount: 0,
    p50Seconds: 0.5, p95Seconds: 2, maxSeconds: 604800,
    worstTimestamp: '2026-07-18T13:10:37.0000000Z',
    worstIngestedAt: '2026-07-24T23:28:52.0000000Z',
  },
}

vi.mock('../api/stats', () => ({
  getSummary: vi.fn(async () => SUMMARY),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getHeatmap: vi.fn(async () => ({ cells: [] })),
  getIngestionLag: vi.fn(async () => LAG),
  getTopErrors: vi.fn(async () => TOP_ERRORS),
  getTopExceptions: vi.fn(async () => TOP_EXCEPTIONS),
  getServices: vi.fn(async () => SERVICES),
  getSlowOperations: vi.fn(async () => SLOW),
  getOperations: vi.fn(async () => OPERATIONS),
  getUserActivity: vi.fn(async () => USERS),
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

describe('DashboardPage', () => {
  it('shows the error rate and level breakdown from the summary', async () => {
    renderPage()
    // ERRORS card rate = (Error 10 + Fatal 10) / total 200 = 10.0%
    expect(await screen.findByText('10.0%')).toBeDefined()
    // EVENTS card breakdown shows the warning count
    expect(screen.getByText('57')).toBeDefined()
  })

  // a headline number on its own says nothing about whether today is unusual; the tiles exist
  // for the comparison, so the comparison is what has to be right
  it('measures the headline figures against the window before them', async () => {
    // the rolling window is the last hour, so the previous window is the one ending before it
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const PREVIOUS = {
      total: 100,
      byLevel: { Verbose: 0, Debug: 0, Information: 60, Warning: 0, Error: 20, Fatal: 20 },
    }
    vi.mocked(stats.getSummary).mockImplementation(async (params) =>
      params.to < cutoff ? PREVIOUS : SUMMARY,
    )

    const { container } = renderPage()
    expect(await screen.findByText('Total events')).toBeDefined()

    // events 200 against 100, errors 20 against 40
    await waitFor(() => expect(container.textContent).toContain('↑ 100%'))
    expect(container.textContent).toContain('↓ 50%')
    expect(container.textContent).toContain('vs previous period')
  })

  it('leaves the comparison off when the previous window held nothing', async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const EMPTY = { total: 0, byLevel: { Verbose: 0, Debug: 0, Information: 0, Warning: 0, Error: 0, Fatal: 0 } }
    vi.mocked(stats.getSummary).mockImplementation(async (params) => (params.to < cutoff ? EMPTY : SUMMARY))

    const { container } = renderPage()
    expect(await screen.findByText('Total events')).toBeDefined()

    await waitFor(() => expect(container.textContent).toContain('200'))
    expect(container.textContent).not.toContain('vs previous period')
  })

  it('groups content under sections and links Activity to Events', async () => {
    renderPage()
    expect(await screen.findByText('Activity')).toBeDefined()
    expect(screen.getByText('Analysis')).toBeDefined()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/events')
    expect(hrefs).toContain('/analysis')
    // the Routes card deep-links to the /requests lens page
    expect(hrefs).toContain('/requests')
  })

  it('renders the analysis, service and user panels', async () => {
    renderPage()
    expect(await screen.findByText('Order {OrderId} failed')).toBeDefined()
    expect(await screen.findByText('OrderService')).toBeDefined()
    expect(await screen.findByText('user-7')).toBeDefined()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/services')
    expect(hrefs).toContain('/users')
  })

  it('lists routes with their p95 latency, verb apart from path', async () => {
    renderPage()
    // the verb is its own coloured label, so a write stands out among reads before reading paths
    expect(await screen.findByText('GET')).toBeDefined()
    expect(screen.getByText('/articles')).toBeDefined()
    expect(screen.getByText('512 ms')).toBeDefined()
    // 512 ms is under the 1 s line, and the panel says so rather than staying silent
    expect(screen.getByText('This route is under 1 s')).toBeDefined()
  })

  // splitting one request template into routes makes each route smaller than a busy job
  // template, so ordering by volume alone would push every route off a panel called Routes
  it('shows routes even when busier operations are not routes', async () => {
    vi.mocked(stats.getOperations).mockResolvedValue({
      operations: [
        { template: 'Processed job {JobId}', method: null, route: null, total: 400, errorCount: 0, p95ElapsedMs: 20 },
        { template: 'GET /articles', method: 'GET', route: '/articles', total: 90, errorCount: 2, p95ElapsedMs: 512 },
      ],
    })
    renderPage()

    expect(await screen.findByText('/articles')).toBeDefined()
    expect(screen.queryByText('Processed job {JobId}')).toBeNull()
  })

  it('counts the routes over the latency line', async () => {
    vi.mocked(stats.getOperations).mockResolvedValue({
      operations: [
        { template: 'GET /articles', method: 'GET', route: '/articles', total: 90, errorCount: 2, p95ElapsedMs: 512 },
        { template: 'POST /orders', method: 'POST', route: '/orders', total: 40, errorCount: 0, p95ElapsedMs: 2450 },
      ],
    })
    renderPage()

    expect(await screen.findByText('1 of 2 routes over 1 s')).toBeDefined()
    expect(screen.getByText('2.5 s')).toBeDefined()
  })

  it('is live by default, with the range picker beside it', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: 'Live' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTitle('Time range')).toBeDefined()
  })

  // the strip sits above the volume charts because it says whether to trust their x-axis
  it('shows how late events arrived, above the charts', async () => {
    renderPage()

    // the tile above prints the same label before any data lands, so wait on the strip's numbers
    expect(await screen.findByText(/worst 7d/)).toBeDefined()
    expect(screen.getByText(/3 arrived late/)).toBeDefined()
  })

  it('picking a range leaves live mode and narrows the queried window', async () => {
    renderPage()

    const picker = await screen.findByTitle('Time range')
    picker.click()
    ;(await screen.findByText('Last 15 minutes')).click()

    const getSummary = vi.mocked(stats.getSummary)
    await waitFor(() => {
      // two windows are queried now — the visible one and the one before it, for the tile
      // comparison — so the window under test is the one that ends latest
      const visible = getSummary.mock.calls
        .map((call) => call[0])
        .reduce<{ from: string; to: string } | null>(
          (newest, params) => (newest === null || params.to > newest.to ? params : newest),
          null,
        )
      expect(visible).not.toBeNull()
      const width = Date.now() - new Date((visible as { from: string }).from).getTime()
      expect(width).toBeLessThanOrEqual(FIFTEEN_MIN_MS + 60_000)
    })
  })
})
