// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { startHydration } from '../api/archive'
import type { ArchiveSegment } from '../types'
import { ArchiveSegments } from './ArchiveSegments'

vi.mock('../api/archive', () => ({
  startHydration: vi.fn(async () => ({ segments: [] })),
  getHydrationStatus: vi.fn(async () => ({ segments: [{ day: '2026-07-01', status: 'hydrated' }] })),
}))

function makeSegment(overrides: Partial<ArchiveSegment> = {}): ArchiveSegment {
  return {
    day: '2026-07-01',
    filePath: '/data/archive/2026-07-01.clef.br',
    eventCount: 1200,
    sizeBytes: 2048,
    uncompressedBytes: 20480,
    status: 'cold',
    hydratedAt: null,
    lastAccessedAt: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function renderList(segments: ArchiveSegment[], canExtract = true) {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ArchiveSegments segments={segments} canExtract={canExtract} />
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists each archived day with its size and status', () => {
  renderList([makeSegment(), makeSegment({ day: '2026-07-02', sizeBytes: 4096, status: 'hydrated' })])

  expect(screen.getByText('2026-07-01')).toBeDefined()
  expect(screen.getByText('2.0 KB')).toBeDefined()
  expect(screen.getByText('4.0 KB')).toBeDefined()
  expect(screen.getByText('Archived')).toBeDefined()
  expect(screen.getByText('Searchable')).toBeDefined()
})

it('extracts the day the button belongs to', async () => {
  renderList([makeSegment()])

  fireEvent.click(screen.getByRole('button', { name: 'Extract' }))

  expect(vi.mocked(startHydration).mock.calls[0]).toEqual([
    '2026-07-01T00:00:00Z',
    '2026-07-01T23:59:59Z',
  ])
  expect(await screen.findByRole('button', { name: 'Extracting…' })).toBeDefined()
})

it('offers no extract button to a viewer', () => {
  renderList([makeSegment()], false)

  expect(screen.queryByRole('button', { name: 'Extract' })).toBeNull()
})

it('says so when nothing is archived', () => {
  renderList([])

  expect(screen.getByText('No archived days yet.')).toBeDefined()
})
