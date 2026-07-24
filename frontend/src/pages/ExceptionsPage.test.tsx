// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import type { Event } from '../types'
import { ExceptionsPage } from './ExceptionsPage'

const LATEST: Event = {
  id: 2,
  timestamp: '2026-07-25T09:30:00.000Z',
  level: 'Error',
  message: 'Order 42 failed',
  messageTemplate: 'Order {OrderId} failed',
  properties: null,
  exception: 'System.NullReferenceException: object was null\n   at OrderService.Ship()',
  ingestedAt: '2026-07-25T09:30:01.000Z',
  traceId: 'abc123def456',
  spanId: null,
}

const SIBLING: Event = {
  id: 1,
  timestamp: '2026-07-25T09:29:58.000Z',
  level: 'Information',
  message: 'Order 42 received',
  messageTemplate: null,
  properties: null,
  exception: null,
  ingestedAt: '2026-07-25T09:29:59.000Z',
  traceId: 'abc123def456',
  spanId: null,
}

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async (params: { filter?: string }) => ({
    // newest first, like the real API
    events: params.filter?.startsWith('@TraceId') ? [LATEST, SIBLING] : [LATEST],
    hasMore: false,
    archivedDays: [],
  })),
}))

vi.mock('../api/stats', () => ({
  getTopExceptions: vi.fn(async () => ({
    exceptions: [
      {
        type: 'System.NullReferenceException',
        count: 88,
        firstSeen: '2026-07-25T08:00:00.000Z',
        lastSeen: '2026-07-25T09:30:00.000Z',
      },
      {
        type: 'System.TimeoutException',
        count: 64,
        firstSeen: '2026-07-25T07:00:00.000Z',
        lastSeen: '2026-07-25T09:00:00.000Z',
      },
    ],
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <ExceptionsPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists exception groups under a narrative headline', async () => {
  renderPage()
  expect(await screen.findByText('System.NullReferenceException')).toBeDefined()
  // headline totals the groups: 88 + 64
  expect(screen.getByText('152 exceptions in this range.')).toBeDefined()
})

it('expands a row into the latest occurrence with its same-trace events', async () => {
  renderPage()
  ;(await screen.findByText('System.NullReferenceException')).click()

  expect(await screen.findByText('Latest occurrence')).toBeDefined()
  expect(screen.getByText(/object was null/)).toBeDefined()
  // the sibling event of the same trace, oldest first
  expect(await screen.findByText('Order 42 received')).toBeDefined()

  const trace = screen.getByText('View full trace ↗')
  const href = trace.getAttribute('href') ?? ''
  // URLSearchParams encodes spaces as '+'
  expect(decodeURIComponent(href.replaceAll('+', ' '))).toContain("@TraceId = 'abc123def456'")
})

it('collapses the context panel when the row is clicked again', async () => {
  renderPage()
  ;(await screen.findByText('System.NullReferenceException')).click()
  await screen.findByText('Latest occurrence')

  screen.getByText('System.NullReferenceException').click()
  await waitFor(() => {
    expect(screen.queryByText('Latest occurrence')).toBeNull()
  })
})

it('starts live and pauses into a static range picker', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByTitle('Time range')).toBeNull()

  toggle.click()
  expect(await screen.findByTitle('Time range')).toBeDefined()
})
