// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { UsersPage } from './UsersPage'

vi.mock('../api/stats', () => ({
  getUserActivity: vi.fn(async () => ({
    users: [{ value: 'alice', total: 40, errorCount: 4, lastSeen: '2026-07-24T10:00:00.000Z' }],
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
          <UsersPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists user activity with its error rate', async () => {
  renderPage()
  expect(await screen.findByText('alice')).toBeDefined()
  // error % = 4 / 40 = 10.0%
  expect(screen.getByText('10.0%')).toBeDefined()
})
