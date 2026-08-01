// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { suggest } from '../api/events'
import { FilterEditor } from './FilterEditor'

vi.mock('../api/events', () => ({
  suggest: vi.fn(async () => ({ suggestions: [] })),
}))

/** Field names first (step 1 asks with no `property`), then that field's values. */
function suggestFields(fields: string[], values: string[]) {
  vi.mocked(suggest).mockImplementation(async ({ property }: { property?: string }) => ({
    suggestions: property ? values : fields,
  }))
}

const TRACE = '0af7651916cd43dd8448eb211c80319c'

afterEach(() => {
  cleanup()
  localStorage.clear()
  // resetAllMocks, not clearAllMocks: clear wipes recorded calls but leaves an
  // implementation an earlier test installed, which then answers every test after it
  // (found 2026-08-01 by running the suite with --sequence.shuffle)
  vi.resetAllMocks()
})

function renderEditor(onSubmit: (chip: unknown) => void = () => {}) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <FilterEditor onSubmit={onSubmit} onCancel={() => {}} />
    </LanguageProvider>,
  )
}

it('offers the trace and span id fields and builds an exact-match chip', () => {
  const onSubmit = vi.fn()
  renderEditor(onSubmit)

  expect(screen.getByText('Span id')).toBeDefined()
  fireEvent.click(screen.getByText('Trace id'))

  // ids are exact-match only: no contains/like/comparison operators
  expect(screen.getByText('is')).toBeDefined()
  expect(screen.getByText('is not')).toBeDefined()
  expect(screen.queryByText('contains')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('value…'), { target: { value: TRACE } })
  fireEvent.click(screen.getByText('Add'))
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'field', field: '@TraceId', op: 'is', value: TRACE })
})

// the value box used to hand its suggestions to a native <datalist>, which the browser draws
// in its own chrome: a white system list on a dark glass card, and nothing the app can style
it('draws value suggestions itself, as buttons on the card', async () => {
  suggestFields(['ChartName'], ['revenue-chart', 'latency-chart'])
  renderEditor()
  fireEvent.change(screen.getByPlaceholderText('Field…'), { target: { value: 'Chart' } })
  fireEvent.click(await screen.findByText('ChartName'))

  const option = await screen.findByRole('button', { name: 'revenue-chart' })
  expect(document.querySelector('datalist')).toBeNull()

  fireEvent.mouseDown(option)
  expect((screen.getByPlaceholderText('value…') as HTMLInputElement).value).toBe('revenue-chart')
})

it('walks the value suggestions with the arrow keys, and only then takes Enter', async () => {
  const onSubmit = vi.fn()
  suggestFields(['ChartName'], ['revenue-chart', 'latency-chart'])
  renderEditor(onSubmit)
  fireEvent.change(screen.getByPlaceholderText('Field…'), { target: { value: 'Chart' } })
  fireEvent.click(await screen.findByText('ChartName'))
  const input = await screen.findByPlaceholderText('value…')
  await screen.findByRole('button', { name: 'latency-chart' })

  // nothing reached for yet: Enter still means "add the chip", as it always has
  fireEvent.change(input, { target: { value: 'typed-by-hand' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledWith({
    kind: 'field', field: 'ChartName', op: 'is', value: 'typed-by-hand',
  })

  onSubmit.mockClear()
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onSubmit).not.toHaveBeenCalled()
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('latency-chart'))
})

// most rows have no trace, so "which of these came from a traced request" is the
// question people actually ask of the field — the same one @Exception answers
it.each(['Trace id', 'Span id'])('offers is set / is not set on %s', (label) => {
  const onSubmit = vi.fn()
  renderEditor(onSubmit)
  fireEvent.click(screen.getByText(label))

  fireEvent.click(screen.getByText('is not set'))
  expect(onSubmit).toHaveBeenCalledWith({
    kind: 'exists',
    field: label === 'Trace id' ? '@TraceId' : '@SpanId',
    present: false,
  })

  fireEvent.click(screen.getByText('is set'))
  expect(onSubmit).toHaveBeenLastCalledWith({
    kind: 'exists',
    field: label === 'Trace id' ? '@TraceId' : '@SpanId',
    present: true,
  })
})
