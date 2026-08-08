// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../../i18n'
import type { AlertRule } from '../../types'
import { AlarmDeck } from './AlarmDeck'

vi.mock('../../hooks/useSignals', () => ({
  useSignals: () => ({ data: [{ id: 7, title: 'errors', filter: "@Level = 'Error'", createdAt: '' }] }),
}))

vi.mock('../../hooks/useAlerts', () => ({
  useAcknowledgeAlert: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

vi.mock('../../hooks/useAuth', () => ({ useIsAdmin: () => true }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
})

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    title: 'errors-spike',
    signalId: 7,
    filter: null,
    thresholdCount: 10,
    windowMinutes: 5,
    webhookUrl: 'https://example.com/hook',
    isEnabled: true,
    createdAt: '2026-08-08T09:00:00.0000000Z',
    lastTriggeredAt: '2026-08-08T09:58:00.0000000Z',
    lastError: null,
    payloadFormat: 'generic',
    condition: 'at-least',
    acknowledgedUntil: null,
    acknowledgedBy: null,
    ...over,
  }
}

/** The filter the "Open events" link carries, read back out of its query string. */
function openEventsFilter() {
  const href = screen.getByRole('link', { name: 'Open events' }).getAttribute('href')!
  return new URL(href, 'http://test.local').searchParams.get('filter')
}

function renderDeck(firing: AlertRule[]) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AlarmDeck firing={firing} from="2026-08-08T09:00:00Z" to="2026-08-08T10:00:00Z" />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

it('opens the signal’s events for a signal-backed rule', () => {
  renderDeck([rule()])

  expect(screen.getByText(/errors —/)).toBeDefined()
  expect(openEventsFilter()).toBe("@Level = 'Error'")
})

// the button used to be rendered only when a signal was found, which silently dropped the most
// useful thing on an alarm for every rule carrying its own filter
it('opens the rule’s own filter when there is no signal', () => {
  renderDeck([rule({ signalId: null, filter: "StatusCode >= 500 and Path = '/api/checkout'" })])

  expect(openEventsFilter()).toBe("StatusCode >= 500 and Path = '/api/checkout'")
})

it('names the filter itself when the rule has no signal to name', () => {
  renderDeck([rule({ signalId: null, filter: "@Level = 'Fatal'" })])

  expect(screen.getByText(/@Level = 'Fatal' —/)).toBeDefined()
})
