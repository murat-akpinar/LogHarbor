// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../i18n'
import { NotFoundPage } from './NotFoundPage'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it('names the missing page and links back to Events', () => {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/no-such-page']}>
        <NotFoundPage />
      </MemoryRouter>
    </LanguageProvider>,
  )

  expect(screen.getByText('Page not found')).toBeDefined()
  const link = screen.getByRole('link', { name: 'Back to Events' })
  expect(link.getAttribute('href')).toBe('/')
})
