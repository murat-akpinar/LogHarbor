// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getAuthStatus } from './api/settings'
import App from './App'

/**
 * The only test that mounts the app itself. Every other page test renders one page inside
 * hand-built providers, which means the wiring App owns — routing, the nav, and the login gate
 * standing in front of everything — was covered by nothing.
 */

vi.mock('./api/settings', () => ({
  getAuthStatus: vi.fn(async () => ({
    authRequired: true,
    authenticated: true,
    username: 'admin',
    role: 'admin',
    mustChangePassword: false,
  })),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  createApiKey: vi.fn(),
  getApiKeys: vi.fn(async () => []),
  revokeApiKey: vi.fn(),
}))

vi.mock('./api/stats', () => ({
  getSummary: vi.fn(async () => ({
    total: 0,
    byLevel: { Verbose: 0, Debug: 0, Information: 0, Warning: 0, Error: 0, Fatal: 0 },
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
  getHeatmap: vi.fn(async () => ({ cells: [] })),
  getIngestionLag: vi.fn(async () => ({
    lateAfterSeconds: 60,
    lag: {
      total: 0, lateCount: 0, skewedCount: 0,
      p50Seconds: 0, p95Seconds: 0, maxSeconds: 0,
      worstTimestamp: null, worstIngestedAt: null,
    },
  })),
  getTopErrors: vi.fn(async () => ({ errors: [] })),
  getTopExceptions: vi.fn(async () => ({ exceptions: [] })),
  getServices: vi.fn(async () => ({ services: [] })),
  getServiceStatus: vi.fn(async () => ({ staleMinutes: 5, asOf: '', services: [] })),
  getSlowOperations: vi.fn(async () => ({
    operations: [], timedOperationCount: 0, comparableOperationCount: 0,
  })),
  getOperations: vi.fn(async () => ({ operations: [] })),
  getUserActivity: vi.fn(async () => ({ users: [] })),
  getQueries: vi.fn(async () => ({ queries: [] })),
}))

vi.mock('./api/events', () => ({
  getEvents: vi.fn(async () => ({ events: [], hasMore: false, archivedDays: [] })),
  getEvent: vi.fn(),
  validateFilter: vi.fn(async () => ({ valid: true })),
  suggest: vi.fn(async () => ({ suggestions: [] })),
  buildExportUrl: () => '/api/events/export',
}))

vi.mock('./api/signals', () => ({
  getSignals: vi.fn(async () => []),
  createSignal: vi.fn(),
  updateSignal: vi.fn(),
  deleteSignal: vi.fn(),
}))

vi.mock('./hooks/useLiveTail', () => ({
  useLiveTail: () => ({
    events: [], pendingCount: 0, status: 'disconnected', error: null, flush: () => {},
  }),
}))

// jsdom has neither, and the event list and charts both need one
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub
;(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  addListener() {}, removeListener() {},
})

function renderApp(path = '/') {
  localStorage.setItem('logharbor-lang', 'en')
  window.history.pushState({}, '', path)
  return render(<App />)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.mocked(getAuthStatus).mockResolvedValue({
    authRequired: true,
    authenticated: true,
    username: 'admin',
    role: 'admin',
    mustChangePassword: false,
  })
})

describe('App', () => {
  it('renders the dashboard at the root behind the nav', async () => {
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeDefined()
    // the nav is App's own composition, not any page's
    expect(screen.getByRole('link', { name: /Events/ })).toBeDefined()
    expect(screen.getByRole('link', { name: /Settings/ })).toBeDefined()
  })

  it('routes each nav entry to its page', async () => {
    renderApp('/')
    await screen.findByRole('heading', { name: 'Dashboard' })

    fireEvent.click(screen.getByRole('link', { name: /Signals/ }))
    expect(await screen.findByRole('heading', { name: 'Signals' })).toBeDefined()

    fireEvent.click(screen.getByRole('link', { name: /Alerts/ }))
    expect(await screen.findByRole('heading', { name: 'Alerts' })).toBeDefined()
  })

  it('answers an unknown route with the not-found page, not a blank screen', async () => {
    renderApp('/no-such-page')

    expect(await screen.findByText('Page not found')).toBeDefined()
  })

  // the gate stands in front of every route; without it a logged-out user sees the whole app
  it('shows the login form instead of any page when the session is gone', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({
      authRequired: true,
      authenticated: false,
      username: null,
      role: null,
      mustChangePassword: false,
    })

    renderApp('/events')

    expect(await screen.findByLabelText('Username')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('link', { name: /Events/ })).toBeNull())
  })

  it('makes an account with a seeded password change it before anything else', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({
      authRequired: true,
      authenticated: true,
      username: 'admin',
      role: 'admin',
      mustChangePassword: true,
    })

    renderApp('/')

    expect(await screen.findByLabelText('New password')).toBeDefined()
    expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull()
  })
})
