// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../../i18n'
import { getRedactionSettings, saveRedactionSettings } from '../../api/settings'
import { RedactionCard } from './RedactionCard'

vi.mock('../../api/settings', () => ({
  getRedactionSettings: vi.fn(async () => ({ properties: ['password'], enabled: true })),
  saveRedactionSettings: vi.fn(async (properties: string[]) => ({
    properties,
    enabled: properties.length > 0,
  })),
}))

vi.mock('../../hooks/useAuth', () => ({ useIsAdmin: () => true }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.mocked(getRedactionSettings).mockResolvedValue({ properties: ['password'], enabled: true })
})

function renderCard() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RedactionCard />
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists what is being redacted', async () => {
  renderCard()
  expect(await screen.findByText('password')).toBeDefined()
})

// every entry destroys data on the way in, so nothing is saved as a side effect of typing
it('does not save until Save is pressed', async () => {
  renderCard()
  await screen.findByText('password')

  screen.getByRole('button', { name: '+ token' }).click()
  await screen.findByText('token')
  expect(vi.mocked(saveRedactionSettings)).not.toHaveBeenCalled()

  screen.getByRole('button', { name: 'Save' }).click()
  await waitFor(() => expect(vi.mocked(saveRedactionSettings)).toHaveBeenCalledWith(['password', 'token']))
})

it('removes a name from the list', async () => {
  renderCard()
  ;(await screen.findByRole('button', { name: 'Stop redacting password' })).click()

  await waitFor(() => expect(screen.queryByText('password')).toBeNull())
  screen.getByRole('button', { name: 'Save' }).click()
  await waitFor(() => expect(vi.mocked(saveRedactionSettings)).toHaveBeenCalledWith([]))
})

// the shipped state, and the one an operator has to be able to recognise at a glance
it('says plainly when nothing is redacted', async () => {
  vi.mocked(getRedactionSettings).mockResolvedValue({ properties: [], enabled: false })
  renderCard()

  expect(await screen.findByText('Nothing is redacted')).toBeDefined()
})
