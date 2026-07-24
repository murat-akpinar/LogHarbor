// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../i18n'
import { Sidebar } from './Sidebar'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderSidebar() {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <MemoryRouter>
        <Sidebar theme="light" onToggleTheme={() => {}} />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

it('renders grouped navigation with an Overview link', () => {
  renderSidebar()
  expect(screen.getByText('Activity')).toBeDefined()
  expect(screen.getByText('System')).toBeDefined()
  expect(screen.getByText('Overview')).toBeDefined()
  expect(screen.getByText('Events')).toBeDefined()
})

it('opens the mobile drawer from the hamburger button', async () => {
  renderSidebar()
  // desktop aside renders one copy; the drawer adds a second
  expect(screen.getAllByText('Events')).toHaveLength(1)
  screen.getByLabelText('Open menu').click()
  await waitFor(() => expect(screen.getAllByText('Events')).toHaveLength(2))
})

it('switches visible link labels when the language toggle is clicked', async () => {
  renderSidebar()
  expect(screen.getByText('Events')).toBeDefined()
  screen.getByText('EN').click()
  expect(await screen.findByText('Olaylar')).toBeDefined()
  expect(screen.queryByText('Events')).toBeNull()
  expect(localStorage.getItem('logharbor-lang')).toBe('tr')
})
