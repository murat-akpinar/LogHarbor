// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const BUCKET_START = '2026-07-24T10:00:00.000Z'
const NEXT_BUCKET = '2026-07-24T10:01:00.000Z'
// the same two columns every lane of the timeline is drawn on; the volume buckets add up to
// SUMMARY, because the chart and the summary are two readings of one window
const VOLUME = {
  buckets: [
    { start: BUCKET_START, counts: { Verbose: 0, Debug: 0, Information: 100, Warning: 40, Error: 6, Fatal: 4 } },
    { start: NEXT_BUCKET, counts: { Verbose: 0, Debug: 0, Information: 33, Warning: 17, Error: 4, Fatal: 6 } },
  ],
}
function statusBuckets(first: number, second: number) {
  const zero = { Verbose: 0, Debug: 0, Warning: 0, Error: 0, Fatal: 0 }
  return {
    buckets: [
      { start: BUCKET_START, counts: { ...zero, Information: first } },
      { start: NEXT_BUCKET, counts: { ...zero, Information: second } },
    ],
  }
}
const LATENCY = {
  avgMs: 24,
  p95Ms: 180,
  sampled: 200,
  buckets: [
    { start: BUCKET_START, avgMs: 22, p95Ms: 140 },
    { start: NEXT_BUCKET, avgMs: 26, p95Ms: 220 },
  ],
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
    { template: 'GET /articles', method: 'GET', route: '/articles', total: 90, errorCount: 2, p95ElapsedMs: 512, folded: false },
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
  // one endpoint feeds four series: the volume lane unfiltered, the request lane per class
  getHistogram: vi.fn(async (params: { filter?: string }) => {
    if (params.filter?.includes('StatusCode >= 500')) return statusBuckets(2, 1)
    if (params.filter?.includes('StatusCode >= 400')) return statusBuckets(7, 5)
    if (params.filter?.includes('StatusCode < 400')) return statusBuckets(80, 40)
    return VOLUME
  }),
  getLatency: vi.fn(async () => LATENCY),
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
    // rate = (Error 10 + Fatal 10) / total 200 = 10.0%, and it reads once: the glance tile
    expect(await screen.findAllByText('10.0%')).toHaveLength(1)
    // the volume lane's legend is its readout, so the warning count is in it
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
    expect(await screen.findByText('Activity')).toBeDefined()

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
    expect(await screen.findByText('Activity')).toBeDefined()

    await waitFor(() => expect(container.textContent).toContain('200'))
    expect(container.textContent).not.toContain('vs previous period')
  })

  // it looks like the filter it is on the Requests page, so it has to behave like one here:
  // it used to navigate away on the first click, which made it feel broken
  it('isolates a status class in place instead of leaving the page', async () => {
    renderPage()

    const only5xx = await screen.findByRole('button', { name: /5xx/ })
    expect(only5xx.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(only5xx)

    await waitFor(() => expect(only5xx.getAttribute('aria-pressed')).toBe('true'))
    // and the way out carries the class the reader picked
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(
      '/requests?status=server',
    )
  })

  // the request chips isolated their class from the start; a legend that reads the same on the
  // other two lanes has to behave the same, which the owner spotted immediately
  it('lets every lane isolate one of its series', async () => {
    renderPage()

    const warn = await screen.findByRole('button', { name: /^Warn/ })
    expect(warn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(warn)
    await waitFor(() => expect(warn.getAttribute('aria-pressed')).toBe('true'))

    const avg = screen.getByRole('button', { name: /^Avg/ })
    fireEvent.click(avg)
    await waitFor(() => expect(avg.getAttribute('aria-pressed')).toBe('true'))

    // each lane is its own lens: picking a line does not clear the level above it
    expect(warn.getAttribute('aria-pressed')).toBe('true')
  })

  // four charts with four time axes made the reader measure across the page; one axis means a
  // slow minute and the errors inside it are the same column
  it('draws volume, duration and requests as lanes of one timeline', async () => {
    renderPage()

    expect(await screen.findByText('Duration')).toBeDefined()
    expect(screen.getByText('Requests')).toBeDefined()
    // one axis for three lanes: the window's start is printed once on the whole card
    expect(await screen.findAllByText(new Date(BUCKET_START).toLocaleString('en'))).toHaveLength(1)
  })

  it('reads every lane off the column under the pointer', async () => {
    renderPage()

    const columns = await screen.findAllByRole('button', { name: /events$/ })
    expect(columns).toHaveLength(2)

    // the lane legends hold the window's figures until a column is picked out
    expect(screen.queryByText('22 ms')).toBeNull()
    fireEvent.mouseEnter(columns[0])

    // one readout for the whole column: volume, duration and status at that instant
    expect(await screen.findByText('22 ms')).toBeDefined()
    expect(screen.getByText('140 ms')).toBeDefined()
    expect(screen.getByText('150')).toBeDefined()
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
        { template: 'Processed job {JobId}', method: null, route: null, total: 400, errorCount: 0, p95ElapsedMs: 20, folded: false },
        { template: 'GET /articles', method: 'GET', route: '/articles', total: 90, errorCount: 2, p95ElapsedMs: 512, folded: false },
      ],
    })
    renderPage()

    expect(await screen.findByText('/articles')).toBeDefined()
    expect(screen.queryByText('Processed job {JobId}')).toBeNull()
  })

  it('counts the routes over the latency line', async () => {
    vi.mocked(stats.getOperations).mockResolvedValue({
      operations: [
        { template: 'GET /articles', method: 'GET', route: '/articles', total: 90, errorCount: 2, p95ElapsedMs: 512, folded: false },
        { template: 'POST /orders', method: 'POST', route: '/orders', total: 40, errorCount: 0, p95ElapsedMs: 2450, folded: false },
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
