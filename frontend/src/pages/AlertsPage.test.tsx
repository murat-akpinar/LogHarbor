// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import type { AlertRule } from '../types'
import { acknowledgeAlert, getAlerts, resumeAlert } from '../api/alerts'
import { AlertsPage } from './AlertsPage'

const RULE: AlertRule = {
  id: 1,
  title: 'errors-spike',
  signalId: 7,
  filter: null,
  thresholdCount: 10,
  windowMinutes: 5,
  webhookUrl: 'https://example.com/hook',
  isEnabled: true,
  createdAt: '2026-08-07T09:00:00.0000000Z',
  lastTriggeredAt: '2026-08-07T10:00:00.0000000Z',
  lastError: null,
  payloadFormat: 'generic',
  condition: 'at-least',
  acknowledgedUntil: null,
  acknowledgedBy: null,
}

let current: AlertRule = RULE

vi.mock('../api/alerts', () => ({
  getAlerts: vi.fn(async () => [current]),
  createAlert: vi.fn(),
  updateAlert: vi.fn(),
  deleteAlert: vi.fn(),
  acknowledgeAlert: vi.fn(async () => current),
  resumeAlert: vi.fn(async () => current),
}))

vi.mock('../api/signals', () => ({
  getSignals: vi.fn(async () => [{ id: 7, title: 'errors', filter: "@Level = 'Error'", createdAt: '' }]),
  createSignal: vi.fn(),
  updateSignal: vi.fn(),
  deleteSignal: vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({ useIsAdmin: () => true }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  current = RULE
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AlertsPage />
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

// an alarm used to be something that happened to you: it fired, and it kept firing every window
// for as long as the condition held, with nothing to press
it('offers durations to silence a rule for', async () => {
  renderPage()
  expect(await screen.findByText('errors-spike')).toBeDefined()

  screen.getByRole('button', { name: 'Acknowledge for 4h' }).click()

  await waitFor(() => expect(vi.mocked(acknowledgeAlert)).toHaveBeenCalledWith(1, 240))
})

it('says how long a silenced rule stays silent, and who took it', async () => {
  const until = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  current = { ...RULE, acknowledgedUntil: until, acknowledgedBy: 'alice' }
  renderPage()

  expect(await screen.findByText(/Silenced until/)).toBeDefined()
  expect(screen.getByText(/by alice/)).toBeDefined()
  // one lever at a time: while it is silenced the durations are gone and Resume is there
  expect(screen.queryByRole('button', { name: 'Acknowledge for 1h' })).toBeNull()
  screen.getByRole('button', { name: 'Resume' }).click()
  await waitFor(() => expect(vi.mocked(resumeAlert)).toHaveBeenCalledWith(1))
})

// the server stops honouring it at that instant, so the row must not go on claiming a silence
it('treats an expired acknowledgement as none', async () => {
  current = {
    ...RULE,
    acknowledgedUntil: new Date(Date.now() - 60 * 1000).toISOString(),
    acknowledgedBy: 'alice',
  }
  renderPage()

  expect(await screen.findByText('errors-spike')).toBeDefined()
  expect(screen.queryByText(/Silenced until/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Acknowledge for 1h' })).toBeDefined()
})

it('asks the server for the rules', async () => {
  renderPage()
  await screen.findByText('errors-spike')
  expect(vi.mocked(getAlerts)).toHaveBeenCalled()
})
