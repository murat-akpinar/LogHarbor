// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { TimeRangeProvider } from '../hooks/useLiveRange'
import { getHistogram, getUserActivity } from '../api/stats'
import { UsersPage } from './UsersPage'

vi.mock('../api/stats', () => ({
  getUserActivity: vi.fn(async () => ({
    users: [{ value: 'alice', total: 40, errorCount: 4, lastSeen: '2026-07-24T10:00:00.000Z', trend: [3, 9, 5] }],
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
        <TimeRangeProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </TimeRangeProvider>
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

// the trend column used to be one histogram request per row, and this table draws fifty of them
it('draws each row its trend without asking for one', async () => {
  renderPage()
  await screen.findByText('alice')

  await waitFor(() => {
    expect(vi.mocked(getUserActivity).mock.calls.some(([params]) => params.trendBuckets === 24)).toBe(true)
  })
  expect(vi.mocked(getHistogram)).not.toHaveBeenCalled()

  const strips = document.querySelectorAll('tbody [data-trend]')
  expect(strips).toHaveLength(1)
  expect(strips[0].children).toHaveLength(3)
})
