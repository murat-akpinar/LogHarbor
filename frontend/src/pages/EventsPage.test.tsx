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
let signals: { id: number; title: string; filter: string }[] = []
vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: signals }),
}))
vi.mock('../api/traces', () => ({
  getTrace: vi.fn(async () => ({ spans: [] })),
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
  // resetAllMocks, not clearAllMocks: clear wipes recorded calls but leaves an
  // implementation an earlier test installed, which then answers every test after it
  // (found 2026-08-01 by running the suite with --sequence.shuffle)
  vi.resetAllMocks()
  signals = []
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

// regression: "View trace" sets the search text, but level chips and active signals are
// AND-ed into the same string — and the panel was matched against that combined string, so
// turning a signal on made the timeline disappear until it was turned off again. The panel
// answers "which trace am I looking at", which is the search text's question alone.
it('keeps the trace timeline while a signal narrows the list', async () => {
  signals = [{ id: 1, title: 'Errors', filter: "@Level = 'Error'" }]
  const traced = { ...SAMPLE_EVENT, id: 2, traceId: TRACE, spanId: 'b7ad6b7169203331' }
  vi.mocked(getEvents).mockResolvedValue({ events: [traced], hasMore: false, archivedDays: [] })
  renderPage('/?filter=' + encodeURIComponent(`@TraceId = '${TRACE}'`))

  expect(await screen.findByText('Trace timeline')).toBeDefined()

  fireEvent.click(screen.getByText('Errors'))
  await waitFor(() => expect(screen.getByText('Trace timeline')).toBeDefined())
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
// It opens on, like every other page: a reader who has just opened a log viewer came for the
// stream, and a reload used to put them back in front of a page with nothing moving on it.
it('opens live and streaming, and stops once it is turned off', async () => {
  renderPage()

  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(useLiveTailSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enabled: true })

  toggle.click()

  // the tail follows the same flag rather than a private one
  await waitFor(() =>
    expect(useLiveTailSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enabled: false }),
  )
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
})

it('keeps a bounded window while paused, instead of falling back to all time', async () => {
  renderPage()
  ;(await screen.findByRole('button', { name: /Live/ })).click()

  // pausing holds the hour that was on screen; it does not widen to everything ever logged
  await waitFor(() => expect(screen.queryByText('All time')).toBeNull())
  expect(vi.mocked(getEvents).mock.calls.at(-1)?.[0]).toEqual(
    expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
  )
})

// A preset is deliberately not this case: it rolls, so it *is* "now" and the tail keeps
// streaming into it. Two ends typed by hand are the window that contradicts live.
it('stops the tail when a fixed window is typed, since that window is not "now"', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')

  screen.getByTitle('Time range').click()
  fireEvent.change(await screen.findByLabelText('To'), { target: { value: '2026-07-24T10:00' } })

  await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
  expect(useLiveTailSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enabled: false })
})

// the preset half of the same rule, which is what makes "Last 15 minutes" survive a page change
it('keeps streaming when a preset is picked, and narrows the window to it', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')

  screen.getByTitle('Time range').click()
  ;(await screen.findByText('Last 15 minutes')).click()

  await waitFor(() => {
    const asked = vi.mocked(getEvents).mock.calls.at(-1)?.[0] as { from: string; to: string }
    const width = new Date(asked.to).getTime() - new Date(asked.from).getTime()
    expect(width).toBe(15 * 60 * 1000)
  })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(useLiveTailSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enabled: true })
})
