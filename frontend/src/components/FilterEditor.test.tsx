// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n'
import { FilterEditor } from './FilterEditor'

vi.mock('../api/events', () => ({
  suggest: vi.fn(async () => ({ suggestions: [] })),
}))

const TRACE = '0af7651916cd43dd8448eb211c80319c'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
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
