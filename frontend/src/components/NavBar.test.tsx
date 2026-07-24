// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../i18n'
import { NavBar } from './NavBar'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderNav() {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <MemoryRouter>
        <NavBar theme="light" onToggleTheme={() => {}} />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

it('puts Events right after Dashboard, then the lens pages', () => {
  renderNav()
  const labels = screen.getAllByRole('link').map((link) => link.textContent)
  expect(labels.slice(0, 4)).toEqual(['Dashboard', 'Events', 'Requests', 'Exceptions'])
})

it('renders an icon inside every nav link', () => {
  renderNav()
  for (const link of screen.getAllByRole('link')) {
    expect(link.querySelector('svg')).not.toBeNull()
  }
})

it('switches visible link labels when the language toggle is clicked', async () => {
  renderNav()
  expect(screen.getByText('Events')).toBeDefined()

  screen.getByText('EN').click()
  expect(await screen.findByText('Olaylar')).toBeDefined()
  expect(screen.queryByText('Events')).toBeNull()
  expect(localStorage.getItem('logharbor-lang')).toBe('tr')
})
