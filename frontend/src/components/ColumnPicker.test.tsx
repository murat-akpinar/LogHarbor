// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { ColumnPicker } from './ColumnPicker'

const PANEL_WIDTH = 224 // w-56

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/**
 * jsdom does no layout, so the button's position and the panel's width are supplied here.
 * That is the whole input to the decision under test — where the toolbar wrapping left the
 * button — and it is the one thing a rendered test cannot observe on its own.
 */
function renderPickerAt(buttonLeft: number, windowWidth = 1280) {
  localStorage.setItem('logharbor-lang', 'en')
  window.innerWidth = windowWidth
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: PANEL_WIDTH,
  })
  render(
    <LanguageProvider>
      <ColumnPicker columns={[]} onChange={() => {}} />
    </LanguageProvider>,
  )
  const button = screen.getByRole('button', { name: /columns/i })
  const anchor = button.parentElement!
  anchor.getBoundingClientRect = () =>
    ({ left: buttonLeft, right: buttonLeft + 90, top: 0, bottom: 32, width: 90, height: 32 }) as DOMRect
  fireEvent.click(button)
  return screen.getByPlaceholderText(/property name/i).closest('div.absolute')!
}

it('hangs the panel off the left of the button when there is room', () => {
  const panel = renderPickerAt(900)

  expect(panel.className).toContain('right-0')
  expect(panel.className).not.toContain('left-0')
})

// the reported bug: the toolbar wraps, the button slides left, and a right-aligned panel
// runs off the window with the property-name input at the bottom of it out of reach
it('flips the panel when right-aligning it would run off the window', () => {
  const panel = renderPickerAt(20)

  expect(panel.className).toContain('left-0')
  expect(panel.className).not.toContain('right-0')
})

it('keeps the panel inside a window narrower than the panel itself', () => {
  const panel = renderPickerAt(10, 200)

  expect(panel.className).toContain('max-w-[calc(100vw-1rem)]')
})
