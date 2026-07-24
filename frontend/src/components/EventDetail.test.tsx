// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { EventDetail } from './EventDetail'
import type { Event } from '../types'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const base: Event = {
  id: 1,
  timestamp: '2026-07-13T10:00:00.0000000Z',
  level: 'Error',
  message: 'boom',
  messageTemplate: null,
  properties: null,
  exception: null,
  ingestedAt: '2026-07-13T10:00:01.0000000Z',
  traceId: null,
  spanId: null,
}

interface Handlers {
  onViewTrace?: (traceId: string) => void
  onFilter?: (filter: string) => void
  onLookAround?: (from: string, to: string) => void
}

function renderDetail(event: Event, handlers: Handlers = {}) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <EventDetail event={event} highlightTerms={[]} onClose={() => {}} {...handlers} />
    </LanguageProvider>,
  )
}

it('hides the trace section when the event has no trace id', () => {
  renderDetail(base)
  expect(screen.queryByText('View trace')).toBeNull()
})

it('shows the trace id and requests the trace filter on click', () => {
  const onViewTrace = vi.fn()
  renderDetail({ ...base, traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331' }, { onViewTrace })

  // the raw JSON dump also contains the id, so target the trace section's span by its title
  expect(screen.getByTitle('0af7651916cd43dd8448eb211c80319c')).toBeDefined()
  screen.getByText('View trace').click()
  expect(onViewTrace).toHaveBeenCalledWith('0af7651916cd43dd8448eb211c80319c')
})

it('shows a relative timestamp carrying the absolute one as its title', () => {
  renderDetail(base)
  const stamp = screen.getByTestId('detail-timestamp')
  expect(stamp.textContent).toMatch(/ago|year|month|day/)
  expect(stamp.getAttribute('title')).toContain('2026')
})

it('turns identity properties into chips that filter on click', () => {
  const onFilter = vi.fn()
  renderDetail({ ...base, properties: '{"Service":"checkout","StatusCode":500,"Path":"/api/orders"}' }, { onFilter })

  screen.getByRole('button', { name: 'Service: checkout' }).click()
  expect(onFilter).toHaveBeenCalledWith("Service = 'checkout'")

  // numbers must not be quoted or the SQLite comparison never matches
  screen.getByRole('button', { name: 'StatusCode: 500' }).click()
  expect(onFilter).toHaveBeenCalledWith('StatusCode = 500')
})

it('offers a filter action per scalar property', () => {
  const onFilter = vi.fn()
  renderDetail({ ...base, properties: '{"OrderId":42,"Tag":"beta"}' }, { onFilter })

  screen.getByRole('button', { name: 'Filter by Tag' }).click()
  expect(onFilter).toHaveBeenCalledWith("Tag = 'beta'")
})

it('surfaces the exception source location', () => {
  renderDetail({
    ...base,
    exception: 'System.NullReferenceException: boom\n   at Api.Ship() in /src/Api/OrderService.cs:line 88',
  })
  expect(screen.getByText('/src/Api/OrderService.cs:88')).toBeDefined()
})

it('asks for the surrounding minutes of this event', () => {
  const onLookAround = vi.fn()
  renderDetail(base, { onLookAround })

  screen.getByRole('button', { name: 'Events around this' }).click()
  const [from, to] = onLookAround.mock.calls[0]
  // a two-minute window on each side of 10:00:00
  expect(from).toBe('2026-07-13T09:58:00.000Z')
  expect(to).toBe('2026-07-13T10:02:00.000Z')
})

it('keeps the raw JSON collapsed until asked for', () => {
  renderDetail(base)
  const details = screen.getByText('Raw JSON').closest('details')
  expect(details).not.toBeNull()
  expect((details as HTMLDetailsElement).open).toBe(false)
})
