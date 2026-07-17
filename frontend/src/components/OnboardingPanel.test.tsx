// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { OnboardingPanel } from './OnboardingPanel'

const getAuthStatus = vi.fn(async () => ({
  authRequired: true,
  authenticated: true,
  username: 'admin',
  role: 'admin' as const,
}))
const createApiKey = vi.fn(async (title: string) => ({
  id: 1,
  title,
  createdAt: '2026-07-17T10:00:00Z',
  token: 'logharbor_testtoken123',
}))

vi.mock('../api/settings', () => ({
  getAuthStatus: (...args: unknown[]) => getAuthStatus(...(args as [])),
  createApiKey: (title: string) => createApiKey(title),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderPanel() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <OnboardingPanel />
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

function snippetText(): string {
  return screen.getByTestId('onboarding-snippet').textContent ?? ''
}

it('shows placeholder snippets until a key is created, then injects the token', async () => {
  renderPanel()

  expect(screen.getByText('Send your first log')).toBeDefined()
  expect(snippetText()).toContain('<API_KEY>')
  expect(snippetText()).toContain('/api/events/raw')

  screen.getByText('Create key').click()
  expect(await screen.findByText('logharbor_testtoken123')).toBeDefined()
  expect(snippetText()).toContain('logharbor_testtoken123')
  expect(snippetText()).not.toContain('<API_KEY>')
})

it('switches tabs; the OTel snippet carries the env var trio', () => {
  renderPanel()

  fireEvent.click(screen.getByText('OpenTelemetry'))
  expect(snippetText()).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
  expect(snippetText()).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf')
  expect(snippetText()).toContain('OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=<API_KEY>')

  fireEvent.click(screen.getByText('Serilog'))
  expect(snippetText()).toContain('WriteTo.Seq')
})

it('copies the visible snippet to the clipboard', () => {
  const writeText = vi.fn(async () => {})
  Object.assign(navigator, { clipboard: { writeText } })
  renderPanel()

  screen.getByText('Copy').click()
  expect(writeText).toHaveBeenCalledWith(snippetText())
})

it('hides key creation from viewers and tells them to ask an admin', async () => {
  getAuthStatus.mockResolvedValueOnce({
    authRequired: true,
    authenticated: true,
    username: 'viewer',
    role: 'viewer' as never,
  })
  renderPanel()

  expect(await screen.findByText(/ask an admin/i)).toBeDefined()
  expect(screen.queryByText('Create key')).toBeNull()
  expect(snippetText()).toContain('<API_KEY>')
})
