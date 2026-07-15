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

it('switches visible link labels when the language toggle is clicked', async () => {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <MemoryRouter>
        <NavBar theme="light" onToggleTheme={() => {}} />
      </MemoryRouter>
    </LanguageProvider>,
  )
  expect(screen.getByText('Events')).toBeDefined()

  screen.getByText('EN').click()
  expect(await screen.findByText('Olaylar')).toBeDefined()
  expect(screen.queryByText('Events')).toBeNull()
  expect(localStorage.getItem('logharbor-lang')).toBe('tr')
})
