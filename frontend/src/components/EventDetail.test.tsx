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

function renderDetail(event: Event, onViewTrace: (traceId: string) => void) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <EventDetail event={event} highlightTerms={[]} onClose={() => {}} onViewTrace={onViewTrace} />
    </LanguageProvider>,
  )
}

it('hides the trace section when the event has no trace id', () => {
  renderDetail(base, () => {})
  expect(screen.queryByText('View trace')).toBeNull()
})

it('shows the trace id and requests the trace filter on click', () => {
  const onViewTrace = vi.fn()
  renderDetail({ ...base, traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331' }, onViewTrace)

  // the raw JSON dump also contains the id, so target the trace section's span by its title
  expect(screen.getByTitle('0af7651916cd43dd8448eb211c80319c')).toBeDefined()
  screen.getByText('View trace').click()
  expect(onViewTrace).toHaveBeenCalledWith('0af7651916cd43dd8448eb211c80319c')
})
