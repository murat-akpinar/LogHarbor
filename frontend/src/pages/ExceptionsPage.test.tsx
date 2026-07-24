// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { ExceptionsPage } from './ExceptionsPage'

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

it('starts live and pauses into a static range picker', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByTitle('Time range')).toBeNull()

  toggle.click()
  expect(await screen.findByTitle('Time range')).toBeDefined()
})
