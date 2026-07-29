// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { FilterBar } from './FilterBar'

vi.mock('../api/events', () => ({
  suggest: vi.fn(async () => ({ suggestions: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function openEditor() {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <FilterBar onCommit={() => {}} />
    </LanguageProvider>,
  )
  fireEvent.click(screen.getByText('+ Add filter'))
  expect(screen.getByText('Span id')).toBeDefined()
}

// clicking the trigger a second time works, but nobody aims for it: the way out of a menu is
// clicking away from it
it('closes the filter menu when the pointer goes down outside it', () => {
  openEditor()

  fireEvent.pointerDown(document.body)

  expect(screen.queryByText('Span id')).toBeNull()
})

it('stays open while the pointer is inside it', () => {
  openEditor()

  fireEvent.pointerDown(screen.getByText('Span id'))

  expect(screen.getByText('Span id')).toBeDefined()
})

it('closes on Escape', () => {
  openEditor()

  fireEvent.keyDown(document, { key: 'Escape' })

  expect(screen.queryByText('Span id')).toBeNull()
})
