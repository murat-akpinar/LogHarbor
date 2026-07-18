// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getEvents } from '../api/events'
import type { Event } from '../types'
import { EventsPage } from './EventsPage'

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({ events: [], hasMore: false, archivedDays: [] })),
  getEvent: vi.fn(),
  validateFilter: vi.fn(async () => ({ valid: true })),
  suggest: vi.fn(async () => ({ suggestions: [] })),
  buildExportUrl: () => '/api/events/export',
}))
vi.mock('../api/settings', () => ({
  getAuthStatus: vi.fn(async () => ({
    authRequired: true,
    authenticated: true,
    username: 'admin',
    role: 'admin',
  })),
  createApiKey: vi.fn(),
}))
vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: [] }),
}))
vi.mock('../hooks/useLiveTail', () => ({
  useLiveTail: () => ({
    events: [],
    pendingCount: 0,
    status: 'disconnected',
    error: null,
    flush: () => {},
  }),
}))

// jsdom has no ResizeObserver; VirtualizedEventList needs one to mount
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub

const SAMPLE_EVENT: Event = {
  id: 1,
  timestamp: '2026-07-17T10:00:00.0000000Z',
  level: 'Information',
  message: 'hello there',
  messageTemplate: null,
  properties: null,
  exception: null,
  ingestedAt: '2026-07-17T10:00:00.0000000Z',
  traceId: null,
  spanId: null,
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderPage(initialEntry = '/') {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <EventsPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('shows the onboarding panel when the server has no events and nothing is filtered', async () => {
  renderPage()
  expect(await screen.findByText('Send your first log')).toBeDefined()
})

it('shows the event list, not the panel, once events exist', async () => {
  vi.mocked(getEvents).mockResolvedValue({ events: [SAMPLE_EVENT], hasMore: false, archivedDays: [] })
  renderPage()

  expect(await screen.findByText('hello there')).toBeDefined()
  expect(screen.queryByText('Send your first log')).toBeNull()
})

it('keeps the normal empty state when a filter is active', async () => {
  vi.mocked(getEvents).mockResolvedValue({ events: [], hasMore: false, archivedDays: [] })
  renderPage('/?filter=' + encodeURIComponent("@Level = 'Error'"))

  expect(await screen.findByText('No events match this filter.')).toBeDefined()
  expect(screen.queryByText('Send your first log')).toBeNull()
})

const TRACE = '0af7651916cd43dd8448eb211c80319c'

it('shows the trace timeline panel when the filter is exactly a trace filter', async () => {
  const traced = { ...SAMPLE_EVENT, id: 2, traceId: TRACE, spanId: 'b7ad6b7169203331' }
  vi.mocked(getEvents).mockResolvedValue({ events: [traced], hasMore: false, archivedDays: [] })
  renderPage('/?filter=' + encodeURIComponent(`@TraceId = '${TRACE}'`))

  expect(await screen.findByText('Trace timeline')).toBeDefined()
})

it('keeps the trace panel hidden for non-trace filters', async () => {
  vi.mocked(getEvents).mockResolvedValue({ events: [SAMPLE_EVENT], hasMore: false, archivedDays: [] })
  renderPage('/?filter=' + encodeURIComponent("@Level = 'Error'"))

  expect(await screen.findByText('hello there')).toBeDefined()
  expect(screen.queryByText('Trace timeline')).toBeNull()
})
