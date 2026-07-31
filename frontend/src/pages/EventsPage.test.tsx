// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { TimeRangeProvider } from '../hooks/useLiveRange'
import { getEvents } from '../api/events'
import { startHydration } from '../api/archive'
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
  // the onboarding panel asks the server how many events it holds in total; zero is a first run
  getHealth: vi.fn(async () => ({ status: 'ok', eventCount: 0, dbSizeBytes: 0, freeDiskBytes: 0 })),
}))
vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: [] }),
}))
vi.mock('../api/archive', () => ({
  startHydration: vi.fn(async () => ({ segments: [] })),
  getHydrationStatus: vi.fn(async () => ({ segments: [{ day: '2026-07-23', status: 'hydrated' }] })),
}))
// spied rather than stubbed: the point of the tests below is *what the page asks for*,
// specifically whether the tail is enabled, so the argument has to be recorded
const useLiveTailSpy = vi.fn((_params: { filter: string; enabled: boolean; paused: boolean }) => ({
  events: [] as never[],
  pendingCount: 0,
  status: 'disconnected' as const,
  error: null,
  flush: () => {},
}))
vi.mock('../hooks/useLiveTail', () => ({
  useLiveTail: (params: { filter: string; enabled: boolean; paused: boolean }) => useLiveTailSpy(params),
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
        <TimeRangeProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <EventsPage />
        </MemoryRouter>
      </TimeRangeProvider>
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

// regression: the API reports which days of the range are in cold storage and the page
// dropped the field, rendering an empty list with no explanation
it('shows the archived-day banner instead of an unexplained empty list', async () => {
  vi.mocked(getEvents).mockResolvedValue({ events: [], hasMore: false, archivedDays: ['2026-07-23'] })
  renderPage()

  expect(await screen.findByText(/1 day in this range is archived/)).toBeDefined()
  expect(screen.getByText('2026-07-23')).toBeDefined()
  // not the "no events yet, send your first log" story — the events exist
  expect(screen.queryByText('Send your first log')).toBeNull()
})

it('extracts the archived range on demand', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [],
    hasMore: false,
    archivedDays: ['2026-07-23', '2026-07-21'],
  })
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Extract them' }))

  await waitFor(() =>
    // bounds come from the days themselves, so an open-ended range still works
    expect(startHydration).toHaveBeenCalledWith('2026-07-21T00:00:00Z', '2026-07-23T23:59:59Z'),
  )
})

it('keeps the banner hidden when the whole range is hot', async () => {
  vi.mocked(getEvents).mockResolvedValue({ events: [SAMPLE_EVENT], hasMore: false, archivedDays: [] })
  renderPage()

  expect(await screen.findByText('hello there')).toBeDefined()
  expect(screen.queryByText(/archived/)).toBeNull()
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

// Events used to keep a private live flag, so the button in the same corner meant the rolling
// window on every other page and the tail here — and turning it on threw the chosen range away
// and showed "All time". One flag now: live rolls the window and streams into it.
it('opens live, like every other page, and streams while it is on', async () => {
  renderPage()

  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  // the tail follows the same flag rather than a private one
  expect(useLiveTailSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enabled: true })
})

it('keeps the window when live is on, instead of jumping to all time', async () => {
  renderPage()
  await screen.findByRole('button', { name: /Live/ })

  // live and a bounded rolling window coexist: new events are inside "the last hour" anyway
  expect(screen.queryByText('All time')).toBeNull()
  expect(vi.mocked(getEvents).mock.calls.at(-1)?.[0]).toEqual(
    expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
  )
})

it('stops the tail when a range is picked, since that window is not "now"', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')

  screen.getByTitle('Time range').click()
  ;(await screen.findByText('Last 15 minutes')).click()

  await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
  expect(useLiveTailSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enabled: false })
})
