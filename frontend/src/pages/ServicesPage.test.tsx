// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { getServices } from '../api/stats'
import { ServicesPage } from './ServicesPage'

vi.mock('../api/stats', () => ({
  // 2880 events over the default 24h range = 2.0/min; 288 errors = 10.0%
  getServices: vi.fn(async () => ({
    services: [
      { service: 'checkout-api', total: 2880, errorCount: 288, p95ElapsedMs: 120 },
      { service: 'worker', total: 144, errorCount: 0, p95ElapsedMs: null },
    ],
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <ServicesPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists services with rate, error percentage and p95', async () => {
  renderPage()

  expect(await screen.findByText('checkout-api')).toBeDefined()
  expect(screen.getByText('2.0')).toBeDefined()
  expect(screen.getByText('10.0%')).toBeDefined()
  expect(screen.getByText('120 ms')).toBeDefined()

  // no Elapsed -> an em dash, not a bogus zero
  expect(screen.getByText('worker')).toBeDefined()
  expect(screen.getByText('0.0%')).toBeDefined()
  expect(screen.getByText('—')).toBeDefined()
})

it('shows the empty state when nothing carries a service identity', async () => {
  vi.mocked(getServices).mockResolvedValue({ services: [] })
  renderPage()

  expect(await screen.findByText(/no events with a service identity/i)).toBeDefined()
})
