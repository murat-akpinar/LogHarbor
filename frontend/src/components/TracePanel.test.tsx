// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getEvents } from '../api/events'
import type { Event } from '../types'
import { TracePanel } from './TracePanel'

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({ events: [], hasMore: false, archivedDays: [] })),
}))

const TRACE = '0af7651916cd43dd8448eb211c80319c'

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 1,
    timestamp: '2026-07-18T10:00:00.000Z',
    level: 'Information',
    message: 'msg',
    messageTemplate: null,
    properties: null,
    exception: null,
    ingestedAt: '2026-07-18T10:00:00.000Z',
    traceId: TRACE,
    spanId: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderPanel(onSelectEvent: (event: Event) => void = () => {}) {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TracePanel traceId={TRACE} onSelectEvent={onSelectEvent} />
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('renders span rows with service, label, duration and a spanless row', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [
      makeEvent({ id: 3, timestamp: '2026-07-18T10:00:00.250Z', spanId: 'b7ad6b7169203331' }),
      makeEvent({
        id: 2,
        timestamp: '2026-07-18T10:00:00.100Z',
        spanId: 'b7ad6b7169203331',
        messageTemplate: 'GET {Path}',
        properties: '{"service.name":"checkout"}',
      }),
      makeEvent({ id: 1, message: 'orphan log' }),
    ],
    hasMore: false,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('Trace timeline')).toBeDefined()
  expect(screen.getByText('checkout')).toBeDefined()
  expect(screen.getByText('GET {Path}')).toBeDefined()
  expect(screen.getByText('150 ms')).toBeDefined()
  expect(screen.getByText('(no span)')).toBeDefined()
  // the single-event spanless row has no duration
  expect(screen.getByText('—')).toBeDefined()
})

it('hands the clicked dot event to onSelectEvent', async () => {
  const boom = makeEvent({
    id: 2,
    timestamp: '2026-07-18T10:00:00.100Z',
    spanId: 'b7ad6b7169203331',
    level: 'Error',
    message: 'boom',
  })
  vi.mocked(getEvents).mockResolvedValue({
    events: [boom, makeEvent({ id: 1, spanId: 'b7ad6b7169203331' })],
    hasMore: false,
    archivedDays: [],
  })
  const onSelectEvent = vi.fn()
  renderPanel(onSelectEvent)

  ;(await screen.findByRole('button', { name: 'Error: boom' })).click()
  expect(onSelectEvent).toHaveBeenCalledWith(boom)
})

it('notes truncation when the API reports more events than fetched', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [makeEvent({ id: 1, spanId: 'b7ad6b7169203331' })],
    hasMore: true,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('Showing the newest 1000 events of this trace.')).toBeDefined()
})

it('explains when the whole trace carries no span ids', async () => {
  vi.mocked(getEvents).mockResolvedValue({
    events: [makeEvent({ id: 1 }), makeEvent({ id: 2, timestamp: '2026-07-18T10:00:00.100Z' })],
    hasMore: false,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('This trace carries no span ids; events sit on one timeline.')).toBeDefined()
  expect(screen.queryByText('(no span)')).toBeNull()
})
