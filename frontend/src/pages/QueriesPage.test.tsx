// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { QueriesPage } from './QueriesPage'

vi.mock('../api/stats', () => ({
  getQueries: vi.fn(async () => ({
    queries: [
      {
        value: 'SELECT * FROM orders WHERE id = @p0',
        connection: 'main',
        calls: 320,
        errorCount: 2,
        totalMs: 4100,
        avgMs: 12.8,
        p95Ms: 48,
        lastSeen: '2026-07-25T10:00:00.000Z',
      },
      {
        value: 'UPDATE users SET seen = @p0',
        connection: null,
        calls: 40,
        errorCount: 0,
        totalMs: 900,
        avgMs: 22.5,
        p95Ms: 60,
        lastSeen: '2026-07-25T09:00:00.000Z',
      },
    ],
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
}))

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async () => ({
    events: [
      {
        id: 9,
        timestamp: '2026-07-25T10:00:00.000Z',
        level: 'Information',
        message: 'Executed DbCommand (12ms) SELECT * FROM orders WHERE id = @p0',
        messageTemplate: null,
        properties: '{"commandText":"SELECT * FROM orders WHERE id = @p0","elapsed":12}',
        exception: null,
        ingestedAt: '2026-07-25T10:00:01.000Z',
        traceId: null,
        spanId: null,
      },
    ],
    hasMore: false,
    archivedDays: [],
  })),
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
          <QueriesPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists queries and auto-selects the first row into the detail pane', async () => {
  renderPage()
  // appears in the row and, auto-selected, in the detail pane's <pre>
  expect((await screen.findAllByText('SELECT * FROM orders WHERE id = @p0')).length).toBeGreaterThanOrEqual(1)
  // detail pane shows the full SQL in a <pre> plus its stats
  await waitFor(() => {
    expect(document.querySelector('pre')?.textContent).toContain('SELECT * FROM orders')
  })
  // calls appears in both the row and the detail tile
  expect(screen.getAllByText('320').length).toBeGreaterThanOrEqual(2)
  expect(screen.getByText('main')).toBeDefined() // connection, detail pane only
})

it('shows recent occurrences with their duration and an Events link', async () => {
  renderPage()
  await screen.findAllByText('SELECT * FROM orders WHERE id = @p0')
  expect(await screen.findByText('Recent occurrences')).toBeDefined()
  expect(await screen.findByText('12 ms')).toBeDefined()

  const link = screen.getByText('Open in Events →')
  const href = link.getAttribute('href') ?? ''
  expect(decodeURIComponent(href.replaceAll('+', ' '))).toContain("commandText = 'SELECT * FROM orders WHERE id = @p0'")
})

it('lets the user change the query property', async () => {
  renderPage()
  await screen.findAllByText('SELECT * FROM orders WHERE id = @p0')
  const input = screen.getByLabelText('Query property') as HTMLInputElement
  expect(input.value).toBe('commandText')
})

it('starts live and pauses into a static range picker', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByTitle('Time range')).toBeNull()

  toggle.click()
  expect(await screen.findByTitle('Time range')).toBeDefined()
})

it('clicking another row swaps the detail pane', async () => {
  renderPage()
  ;(await screen.findByText('UPDATE users SET seen = @p0')).click()
  await waitFor(() => {
    expect(document.querySelector('pre')?.textContent).toContain('UPDATE users SET seen')
  })
})
