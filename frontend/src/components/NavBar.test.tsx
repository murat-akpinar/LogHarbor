// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import type { AuthStatus } from '../types'
import { NavBar } from './NavBar'

const authStatus: AuthStatus = {
  authRequired: true,
  authenticated: true,
  username: 'admin',
  role: 'admin',
  mustChangePassword: false, ldapEnabled: false,
}

vi.mock('../api/settings', () => ({
  getAuthStatus: vi.fn(async () => authStatus),
  logout: vi.fn(async () => {}),
  login: vi.fn(),
  changePassword: vi.fn(),
}))

const { getAuthStatus, logout } = await import('../api/settings')

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.mocked(getAuthStatus).mockResolvedValue(authStatus)
  vi.mocked(logout).mockClear()
})

function renderNav() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <NavBar theme="light" onToggleTheme={() => {}} />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('puts Events right after Dashboard, then the lens pages', () => {
  renderNav()
  // index 0 is the wordmark, which is a link to the dashboard rather than a page tab
  const labels = screen.getAllByRole('link').map((link) => link.textContent)
  expect(labels.slice(1, 5)).toEqual(['Dashboard', 'Events', 'Requests', 'Exceptions'])
})

it('takes the wordmark home', () => {
  renderNav()
  expect(screen.getByRole('link', { name: 'LogHarbor' }).getAttribute('href')).toBe('/')
})

it('renders an icon inside every page link', () => {
  renderNav()
  // the wordmark carries the brand dot instead, so the page tabs start at index 1
  for (const link of screen.getAllByRole('link').slice(1)) {
    expect(link.querySelector('svg')).not.toBeNull()
  }
})

it('switches visible link labels when the language toggle is clicked', async () => {
  renderNav()
  expect(screen.getByText('Events')).toBeDefined()

  screen.getByText('EN').click()
  expect(await screen.findByText('Olaylar')).toBeDefined()
  expect(screen.queryByText('Events')).toBeNull()
  expect(localStorage.getItem('logharbor-lang')).toBe('tr')
})

it('signs out from the nav, and names the account in the tooltip', async () => {
  renderNav()
  const button = await screen.findByLabelText('Sign out')
  expect(button.getAttribute('title')).toBe('Signed in as admin (admin)')

  button.click()

  await waitFor(() => expect(logout).toHaveBeenCalledOnce())
})

// an instance with no accounts has no session, so the button would end nothing
it('hides sign out when the server does not require auth', async () => {
  vi.mocked(getAuthStatus).mockResolvedValue({ ...authStatus, authRequired: false, authenticated: true })
  renderNav()

  await screen.findByText('Dashboard')
  await waitFor(() => expect(screen.queryByLabelText('Sign out')).toBeNull())
})
