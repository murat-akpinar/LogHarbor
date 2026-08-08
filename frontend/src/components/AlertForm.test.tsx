// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { validateFilter } from '../api/events'
import { AlertForm } from './AlertForm'

vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: [{ id: 1, title: 'errors', filter: "@Level = 'Error'", createdAt: '' }] }),
}))

vi.mock('../api/events', () => ({ validateFilter: vi.fn(async () => ({ valid: true })) }))

// resetAllMocks below wipes the factory's implementation too, so the happy answer is reinstalled
// per test rather than declared once at the top
beforeEach(() => {
  vi.mocked(validateFilter).mockResolvedValue({ valid: true })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  // resetAllMocks, not clearAllMocks: clear wipes recorded calls but leaves an
  // implementation an earlier test installed, which then answers every test after it
  // (found 2026-08-01 by running the suite with --sequence.shuffle)
  vi.resetAllMocks()
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

  // combobox order: [condition, what it watches, payload format]
  const combos = screen.getAllByRole('combobox')
  fireEvent.change(combos[1], { target: { value: 'signal:1' } })   // watch the saved signal
  fireEvent.change(combos[0], { target: { value: 'silence' } })    // condition

  expect(screen.queryByPlaceholderText('Count')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'dead-cron' } })
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: 'https://x.test/hook' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ condition: 'silence', thresholdCount: 0, signalId: 1, filter: null }),
    ),
  )
})

// the point of the whole feature: a fresh install has no signals, so the form must open on a
// filter box and not on a signal picker with nothing in it
it('watches its own filter by default and submits it without a signal', async () => {
  const onSubmit = vi.fn(async () => ({}))
  renderForm(onSubmit)

  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'checkout-5xx' } })
  fireEvent.change(screen.getByPlaceholderText("@Level = 'Error'"), {
    target: { value: "StatusCode >= 500 and Path = '/api/checkout'" },
  })
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: 'https://x.test/hook' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: null, filter: "StatusCode >= 500 and Path = '/api/checkout'" }),
    ),
  )
})

it('picking a saved signal takes the filter box away', () => {
  renderForm(vi.fn(async () => ({})))

  expect(screen.queryByPlaceholderText("@Level = 'Error'")).not.toBeNull()
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'signal:1' } })
  expect(screen.queryByPlaceholderText("@Level = 'Error'")).toBeNull()
})

it('an unparseable filter is reported and never submitted', async () => {
  vi.mocked(validateFilter).mockResolvedValue({ valid: false, error: 'Unexpected token', position: 7 })
  const onSubmit = vi.fn(async () => ({}))
  renderForm(onSubmit)

  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'broken' } })
  fireEvent.change(screen.getByPlaceholderText("@Level = 'Error'"), { target: { value: '@Level = = x' } })
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: 'https://x.test/hook' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() => expect(screen.queryByText(/Unexpected token/)).not.toBeNull())
  expect(onSubmit).not.toHaveBeenCalled()
})
