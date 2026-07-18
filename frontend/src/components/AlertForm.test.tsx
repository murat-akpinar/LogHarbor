// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { AlertForm } from './AlertForm'

vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: [{ id: 1, title: 'errors', filter: "@Level = 'Error'", createdAt: '' }] }),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderForm(onSubmit: (request: unknown) => Promise<unknown>) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <AlertForm submitLabel="Create" onSubmit={onSubmit} />
    </LanguageProvider>,
  )
}

it('hides the threshold field for a silence rule and submits condition silence', async () => {
  const onSubmit = vi.fn(async () => ({}))
  renderForm(onSubmit)

  // at-least is the default, so the threshold field is present
  expect(screen.getByPlaceholderText('Count')).toBeDefined()

  // combobox order: [condition, signal, payload format]
  const combos = screen.getAllByRole('combobox')
  fireEvent.change(combos[1], { target: { value: '1' } })          // signal
  fireEvent.change(combos[0], { target: { value: 'silence' } })    // condition

  expect(screen.queryByPlaceholderText('Count')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'dead-cron' } })
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: 'https://x.test/hook' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ condition: 'silence', thresholdCount: 0, signalId: 1 }),
    ),
  )
})
