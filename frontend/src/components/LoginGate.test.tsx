// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { LoginGate } from './LoginGate'

const getAuthStatus = vi.fn()

vi.mock('../api/settings', () => ({
  getAuthStatus: (...args: unknown[]) => getAuthStatus(...(args as [])),
  login: vi.fn(),
  changePassword: vi.fn(),
  logout: vi.fn(),
}))

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('lit')
  vi.resetAllMocks()
})

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <LoginGate>
          <p>signed in</p>
        </LoginGate>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

// The canvas behind the app is neutral so a day of log reading is not spent under a
// coloured bloom; the sign-in screen is the one place that keeps it. Nothing else in the
// app can tell you the wash is missing, so this is the only guard the colour has.
it('lights the canvas while the sign-in screen is up', async () => {
  getAuthStatus.mockResolvedValue({
    authRequired: true,
    authenticated: false,
    username: null,
    role: null,
  })

  renderGate()

  expect(await screen.findByRole('button', { name: /→/ })).toBeTruthy()
  expect(document.documentElement.classList.contains('lit')).toBe(true)
})

it('leaves the canvas neutral once the app is behind the gate', async () => {
  getAuthStatus.mockResolvedValue({
    authRequired: true,
    authenticated: true,
    username: 'admin',
    role: 'admin' as const,
  })

  renderGate()

  expect(await screen.findByText('signed in')).toBeTruthy()
  expect(document.documentElement.classList.contains('lit')).toBe(false)
})
