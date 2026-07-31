// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import type { ApiKey, AuthStatus, CreatedApiKey } from '../types'
import { SendLogsPage } from './SendLogsPage'

const KEYS: ApiKey[] = [
  { id: 1, title: 'checkout-prod', createdAt: '2026-07-01T10:00:00Z', isActive: true },
  { id: 2, title: 'batch-jobs', createdAt: '2026-07-02T10:00:00Z', isActive: true },
]

const CREATED: CreatedApiKey = {
  id: 3,
  title: 'new-key',
  token: 'logharbor_deadbeef',
  createdAt: '2026-07-31T10:00:00Z',
}

let authStatus: AuthStatus = {
  authRequired: true,
  authenticated: true,
  username: 'admin',
  role: 'admin',
  mustChangePassword: false,
  ldapEnabled: false,
}

vi.mock('../api/settings', () => ({
  getApiKeys: vi.fn(async () => KEYS),
  createApiKey: vi.fn(async () => CREATED),
  getAuthStatus: vi.fn(async () => authStatus),
  getHealth: vi.fn(),
  revokeApiKey: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}))

const { createApiKey } = await import('../api/settings')

afterEach(() => {
  cleanup()
  localStorage.clear()
  authStatus = { ...authStatus, role: 'admin' }
  vi.clearAllMocks()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <SendLogsPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

function snippets(): string[] {
  return Array.from(document.querySelectorAll('pre')).map((node) => node.textContent ?? '')
}

it('offers both named options and the raw HTTP fallback', async () => {
  renderPage()
  expect(await screen.findByRole('heading', { name: 'OpenTelemetry' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Serilog' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'HTTP (CLEF)' })).toBeDefined()
})

// the three env vars ARE the OpenTelemetry answer: get one wrong and the SDK buffers forever
it('carries the OTLP endpoint, protocol and key header', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'OpenTelemetry' })

  const otel = snippets().find((text) => text.includes('OTEL_EXPORTER_OTLP_ENDPOINT'))
  expect(otel).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT=${window.location.origin}`)
  expect(otel).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf')
  expect(otel).toContain('OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=')
})

// a batching sink that is never flushed is the single most common way a short script sends
// nothing at all, so the line has to be in the snippet rather than in prose beside it
it('keeps the flush in the Serilog snippet', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Serilog' })

  const serilog = snippets().find((text) => text.includes('WriteTo.Seq'))
  expect(serilog).toContain('Log.CloseAndFlush()')
  expect(serilog).toContain(`.WriteTo.Seq("${window.location.origin}"`)
})

// a token exists in plaintext exactly once, at creation; a page that filled one in from the
// key list would be printing something that is not a key
it('shows a placeholder until a key is minted here, then the real token', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Serilog' })
  expect(snippets().every((text) => !text.includes('logharbor_deadbeef'))).toBe(true)
  expect(snippets().some((text) => text.includes('<your-api-key>'))).toBe(true)

  screen.getByRole('button', { name: 'Create key' }).click()

  await waitFor(() => expect(createApiKey).toHaveBeenCalled())
  await waitFor(() => expect(snippets().some((text) => text.includes('logharbor_deadbeef'))).toBe(true))
})

it('names an already-existing key in the snippet without inventing its token', async () => {
  renderPage()
  // the list arrives from /api/apikeys, so wait for it rather than for the first render
  expect(await screen.findByRole('option', { name: 'checkout-prod' })).toBeDefined()
  expect(screen.getByRole('option', { name: 'batch-jobs' })).toBeDefined()
  // naming a key is all it can do: the token behind it is stored only as a hash
  expect(snippets().some((text) => text.includes('<your-api-key>'))).toBe(true)
})

it('tells a viewer to ask an admin instead of offering the create form', async () => {
  authStatus = { ...authStatus, role: 'viewer' }
  renderPage()
  expect(await screen.findByText(/Ask an admin to create an API key/)).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull()
})

// the point of the page: not the snippet, but what the snippet costs you
it('says what arrives for every option', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'OpenTelemetry' })

  // three options x six fields
  expect(screen.getAllByText('Message template')).toHaveLength(3)
  expect(screen.getAllByText('Trace id')).toHaveLength(3)
  // and the three differ, which is the whole reason they are listed side by side
  expect(screen.getByText(/only if you send @tr and @sp yourself/)).toBeDefined()
  expect(screen.getByText(/inside an active span/)).toBeDefined()
  expect(screen.getByText(/inside an active Activity/)).toBeDefined()
})
