// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../../i18n'
import type { Finding } from '../../types'
import { FindingsBand } from './FindingsBand'

// each row draws a sparkline, which fetches its own histogram; the shape is asserted separately
// in lib/findings.test.ts, so here the request only has to not blow up
vi.mock('../../api/stats', () => ({ getHistogram: vi.fn(async () => ({ buckets: [] })) }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
})

/** Renders the destination's query string so a deep link can be asserted on. */
function EventsProbe() {
  return <div data-testid="events-query">{useLocation().search}</div>
}

function renderBand(findings: Finding[]) {
  localStorage.setItem('logharbor-lang', 'en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <LanguageProvider>
          <Routes>
            <Route
              path="/"
              element={
                <FindingsBand findings={findings} from="2026-08-08T09:00:00Z" to="2026-08-08T10:00:00Z" />
              }
            />
            <Route path="/events" element={<EventsProbe />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const QUIET: Finding = {
  kind: 'went_quiet',
  subject: 'billing',
  filter: "(service.name = 'billing' or Service = 'billing')",
  now: 0,
  baseline: 40,
  count: 0,
}

const SLOW: Finding = {
  kind: 'slower_than_usual',
  subject: 'DB query {Query} took {Elapsed} ms',
  filter: "@MessageTemplate = 'DB query {Query} took {Elapsed} ms'",
  now: 6739,
  baseline: 2141,
  count: 104,
}

it('says a quiet service in words, with what it usually sends', () => {
  renderBand([QUIET])

  expect(screen.getByText(/billing has sent nothing this range/)).toBeDefined()
  expect(screen.getByText(/about 40/)).toBeDefined()
})

it('says a slowdown as p95 now versus usual', () => {
  renderBand([SLOW])

  expect(screen.getByText(/p95 6,739 ms, usually 2,141 ms/)).toBeDefined()
})

it('phrases a new exception by its count, not by a baseline it does not have', () => {
  renderBand([{
    kind: 'new_exception',
    subject: 'Acme.Checkout.CartEmptyException',
    filter: "@Exception like 'Acme.Checkout.CartEmptyException%'",
    now: 27,
    baseline: 0,
    count: 27,
  }])

  expect(screen.getByText(/27×, never recorded on this server before/)).toBeDefined()
})

it('phrases a failing route as a share, with where it came from', () => {
  renderBand([{
    kind: 'failing_route',
    subject: 'GET /api/checkout',
    filter: "Path = '/api/checkout' and Method = 'GET'",
    now: 30,
    baseline: 2,
    count: 12,
  }])

  expect(screen.getByText(/failing 30% of requests, up from 2%/)).toBeDefined()
})

// the finding carries the filter the server derived it from; the band must hand that through
// untouched rather than rebuild one from the subject text
it('opens the events behind a finding with the filter the server sent', () => {
  renderBand([QUIET])

  fireEvent.click(screen.getByRole('button'))

  const query = new URLSearchParams(screen.getByTestId('events-query').textContent!)
  expect(query.get('filter')).toBe("(service.name = 'billing' or Service = 'billing')")
  expect(query.get('from')).toBe('2026-08-08T09:00:00Z')
  expect(query.get('to')).toBe('2026-08-08T10:00:00Z')
})

it('counts what it found', () => {
  renderBand([QUIET, SLOW])

  expect(screen.getAllByRole('button')).toHaveLength(2)
  expect(screen.getByText('2')).toBeDefined()
})
