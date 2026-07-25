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
const OPERATIONS = { operations: [{ template: 'GET /articles', total: 90, errorCount: 2, p95ElapsedMs: 512 }] }
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

  it('lists routes with their p95 latency', async () => {
    renderPage()
    expect(await screen.findByText('GET /articles')).toBeDefined()
    expect(screen.getByText('512 ms')).toBeDefined()
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

    expect(await screen.findByText('Ingestion lag')).toBeDefined()
    expect(screen.getByText(/worst 7d/)).toBeDefined()
    expect(screen.getByText(/3 arrived late/)).toBeDefined()
  })

  it('picking a range leaves live mode and narrows the queried window', async () => {
    renderPage()

    const picker = await screen.findByTitle('Time range')
    picker.click()
    ;(await screen.findByText('Last 15 minutes')).click()

    const getSummary = vi.mocked(stats.getSummary)
    await waitFor(() => {
      const lastFrom = getSummary.mock.calls.at(-1)?.[0]?.from
      expect(lastFrom).toBeDefined()
      const width = Date.now() - new Date(lastFrom as string).getTime()
      expect(width).toBeLessThanOrEqual(FIFTEEN_MIN_MS + 60_000)
    })
  })
})
