// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getEvents } from '../api/events'
import { getTrace } from '../api/traces'
import type { Event } from '../types'
import { TracePanel } from './TracePanel'
import { DURATION_W, LABEL_W } from './SpanTimeline'

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({ events: [], hasMore: false, archivedDays: [] })),
}))
vi.mock('../api/traces', () => ({
  getTrace: vi.fn(async () => ({ spans: [] })),
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

/** A 120 ms root span, the smallest trace that still has a shape to zoom into. */
function span() {
  return {
    traceId: TRACE, spanId: 'root', parentSpanId: null, name: 'GET /cart', kind: 'server',
    service: 'checkout', startTimestamp: '2026-07-18T10:00:00.000Z', durationMs: 120,
    statusCode: 'error', statusMessage: 'boom', attributes: null,
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

it('renders the real waterfall when the trace has spans', async () => {
  vi.mocked(getTrace).mockResolvedValue({
    spans: [
      {
        traceId: TRACE, spanId: 'root', parentSpanId: null, name: 'GET /cart', kind: 'server',
        service: 'checkout', startTimestamp: '2026-07-18T10:00:00.000Z', durationMs: 120,
        statusCode: 'error', statusMessage: 'boom', attributes: null,
      },
    ],
  })
  vi.mocked(getEvents).mockResolvedValue({ events: [], hasMore: false, archivedDays: [] })
  renderPanel()

  expect(await screen.findByRole('button', { name: /GET \/cart/ })).toBeDefined()
  // twice, and correctly so: a one-span trace's total IS that span's duration — once in the
  // header's Total chip, once in the row's own duration column
  expect(screen.getAllByText('120 ms')).toHaveLength(2)
  // the header names what the trace is and what it cost, before any bar is read
  expect(screen.getByRole('heading', { name: 'GET /cart' })).toBeDefined()

  // clicking the span opens its detail with the status message
  screen.getByRole('button', { name: /GET \/cart/ }).click()
  expect(await screen.findByText(/error — boom/)).toBeDefined()
})

// spans that finish in a millisecond are a single pixel at fit width; zoom is the only way to
// see the order they ran in
it('stretches the timeline on zoom and snaps back to fit', async () => {
  vi.mocked(getTrace).mockResolvedValue({ spans: [span()] })
  renderPanel()

  await screen.findByRole('button', { name: /GET \/cart/ })
  const track = screen.getByTestId('span-timeline')
  expect(track.style.width).toBe('100%')
  expect((screen.getByLabelText('Fit the whole trace') as HTMLButtonElement).disabled).toBe(true)

  screen.getByLabelText('Zoom in').click()

  await waitFor(() => expect(screen.getByTestId('span-timeline').style.width).toBe('160%'))
  expect(screen.getByText('1.6×')).toBeDefined()

  screen.getByLabelText('Fit the whole trace').click()
  await waitFor(() => expect(screen.getByTestId('span-timeline').style.width).toBe('100%'))
})

it('reads the offset under the pointer off the time axis', async () => {
  vi.mocked(getTrace).mockResolvedValue({ spans: [span()] })
  renderPanel()

  await screen.findByRole('button', { name: /GET \/cart/ })
  const track = screen.getByTestId('span-timeline')
  // jsdom has no layout: give the element a box so the pointer maths has something to divide by
  Object.defineProperty(track, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 640, bottom: 100, width: 640, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  })

  // the track is what is left of 640px once the label and duration columns have taken theirs;
  // the widths come from the component so this cannot drift when a column is resized
  const trackWidth = 640 - LABEL_W - DURATION_W
  fireEvent.mouseMove(track, { clientX: LABEL_W + trackWidth / 2 })
  expect(await screen.findByText('60.0ms')).toBeDefined()

  fireEvent.mouseLeave(track)
  await waitFor(() => expect(screen.queryByText('60.0ms')).toBeNull())
})

it('falls back to the inferred layout when the trace has no spans', async () => {
  vi.mocked(getTrace).mockResolvedValue({ spans: [] })
  vi.mocked(getEvents).mockResolvedValue({
    events: [makeEvent({ id: 1, spanId: 'b7ad6b7169203331', messageTemplate: 'inferred-op' })],
    hasMore: false,
    archivedDays: [],
  })
  renderPanel()

  expect(await screen.findByText('inferred-op')).toBeDefined()
})
