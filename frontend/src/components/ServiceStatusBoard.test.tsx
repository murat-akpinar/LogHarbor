// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import type { ServiceStatusRow } from '../types'
import { ServiceStatusBoard } from './ServiceStatusBoard'

function makeRow(overrides: Partial<ServiceStatusRow> = {}): ServiceStatusRow {
  return {
    host: 'web-1',
    kind: 'systemd',
    service: 'nginx',
    status: 'up',
    state: 'active',
    health: null,
    lastSeen: '2026-07-25T09:19:30.0000000Z',
    secondsSinceLastSeen: 30,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderBoard(services: ServiceStatusRow[], onOpen = vi.fn()) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <ServiceStatusBoard services={services} onOpen={onOpen} />
    </LanguageProvider>,
  )
  return onOpen
}

it('shows nothing at all when no probe has reported', () => {
  const { container } = render(
    <LanguageProvider>
      <ServiceStatusBoard services={[]} onOpen={vi.fn()} />
    </LanguageProvider>,
  )

  expect(container.textContent).toBe('')
})

it('names every status in words, not only in colour', () => {
  renderBoard([
    makeRow({ service: 'db', status: 'down', state: 'exited' }),
    makeRow({ service: 'cron', status: 'stale' }),
    makeRow({ service: 'api', status: 'unhealthy', health: 'unhealthy' }),
    makeRow({ service: 'redis', status: 'unknown', state: null }),
    makeRow(),
  ])

  expect(screen.getByText('down')).toBeDefined()
  expect(screen.getByText('no heartbeat')).toBeDefined()
  expect(screen.getByText('unhealthy')).toBeDefined()
  expect(screen.getByText('unknown')).toBeDefined()
  expect(screen.getByText('up')).toBeDefined()
})

it('groups services under their host and counts what is not up', () => {
  renderBoard([
    makeRow({ host: 'web-2', service: 'db', status: 'down' }),
    makeRow({ host: 'web-1', service: 'nginx' }),
    makeRow({ host: 'web-1', service: 'cron' }),
  ])

  expect(screen.getByText('web-1')).toBeDefined()
  expect(screen.getByText('web-2')).toBeDefined()
  expect(screen.getByText('2 up')).toBeDefined()
  // each host line counts its own host; the section header counts the whole board, so the one
  // host that is down is reported in both places
  expect(screen.getAllByText('1 not up')).toHaveLength(2)
})

it('shows the raw state word and how old the reading is', () => {
  renderBoard([makeRow({ status: 'down', state: 'failed', secondsSinceLastSeen: 120 })])

  expect(screen.getByText(/failed/)).toBeDefined()
  expect(screen.getByText(/2 minutes ago/)).toBeDefined()
})

it('opens the service its tile belongs to', () => {
  const onOpen = renderBoard([
    makeRow({ service: 'nginx' }),
    makeRow({ service: 'cron' }),
  ])

  fireEvent.click(screen.getByRole('button', { name: /cron/ }))

  expect(onOpen.mock.calls[0][0].service).toBe('cron')
})
