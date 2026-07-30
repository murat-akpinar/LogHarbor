// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getAuthStatus, login } from './api/settings'
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
    mustChangePassword: false, ldapEnabled: false,
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
    mustChangePassword: false, ldapEnabled: false,
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
      mustChangePassword: false, ldapEnabled: false,
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
      mustChangePassword: true, ldapEnabled: false,
    })

    renderApp('/')

    expect(await screen.findByLabelText('New password')).toBeDefined()
    expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull()
  })

  const loggedOut = (ldapEnabled: boolean) => ({
    authRequired: true,
    authenticated: false,
    username: null,
    role: null,
    mustChangePassword: false,
    ldapEnabled,
  })

  // the tab stays visible before a directory exists so the feature has a home, but it must not
  // take credentials it has nowhere to send
  it('offers the LDAP tab but disables it until a directory is configured', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue(loggedOut(false))
    renderApp('/events')

    fireEvent.click(await screen.findByRole('tab', { name: 'LDAP' }))

    expect((screen.getByLabelText('Username') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/not set up on this instance yet/)).toBeDefined()
  })

  it('takes directory credentials once one is configured', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue(loggedOut(true))
    renderApp('/events')

    fireEvent.click(await screen.findByRole('tab', { name: 'LDAP' }))

    const username = screen.getByLabelText('Directory username') as HTMLInputElement
    expect(username.disabled).toBe(false)
    expect(screen.queryByText(/not set up on this instance yet/)).toBeNull()
  })

  // the method has to travel with the credentials, or a domain user is checked against the
  // local account table and always refused
  it('sends the chosen method with the credentials', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue(loggedOut(true))
    vi.mocked(login).mockResolvedValue({
      authenticated: true, username: 'testuser1', role: 'viewer', mustChangePassword: false,
    })
    renderApp('/events')

    fireEvent.click(await screen.findByRole('tab', { name: 'LDAP' }))
    fireEvent.change(screen.getByLabelText('Directory username'), { target: { value: 'testuser1' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'testpass123' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('testuser1', 'testpass123', 'ldap'))
  })

  // a domain user should not have to re-pick LDAP every morning
  it('remembers the chosen method', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue(loggedOut(true))
    renderApp('/events')

    fireEvent.click(await screen.findByRole('tab', { name: 'LDAP' }))
    expect(localStorage.getItem('logharbor-login-method')).toBe('ldap')
  })

  // a remembered choice must not strand someone on a tab that stopped working
  it('falls back to standard when a remembered directory is switched off again', async () => {
    localStorage.setItem('logharbor-login-method', 'ldap')
    vi.mocked(getAuthStatus).mockResolvedValue(loggedOut(false))
    renderApp('/events')

    // the LDAP tab is still selected, and says why it cannot be used
    expect(await screen.findByText(/not set up on this instance yet/)).toBeDefined()
    expect((screen.getByLabelText('Username') as HTMLInputElement).disabled).toBe(true)
  })
})
