// @vitest-environment jsdom
import { afterEach, expect, it, vi, describe } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../../i18n'
import type { IngestionLag } from '../../types'
import { IngestionLagStrip, formatLag } from './IngestionLagStrip'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

const CLEAN: IngestionLag = {
  total: 100,
  lateCount: 0,
  skewedCount: 0,
  p50Seconds: 0.4,
  p95Seconds: 1,
  maxSeconds: 2,
  worstTimestamp: '2026-07-25T10:00:00.0000000Z',
  worstIngestedAt: '2026-07-25T10:00:02.0000000Z',
}

function renderStrip(lag: IngestionLag) {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <MemoryRouter>
        <IngestionLagStrip lag={lag} />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('formatLag', () => {
  const u = { s: 's', m: 'm', h: 'h', d: 'd' }
  it('picks the coarsest honest unit', () => {
    expect(formatLag(0, u)).toBe('0s')
    expect(formatLag(45, u)).toBe('45s')
    expect(formatLag(180, u)).toBe('3m')
    expect(formatLag(7200, u)).toBe('2h')
    expect(formatLag(604800, u)).toBe('7d')
  })

  it('never shows negative time', () => {
    expect(formatLag(-30, u)).toBe('0s')
  })
})

it('says everything is on time when nothing is late', () => {
  renderStrip(CLEAN)

  expect(screen.getByText(/everything arrived on time/)).toBeDefined()
  expect(screen.queryByRole('button')).toBeNull()
})

it('renders nothing at all for an empty range', () => {
  const { container } = (() => {
    renderStrip({ ...CLEAN, total: 0 })
    return { container: document.body }
  })()

  expect(container.textContent).toBe('')
})

// the shape the July 2026 backfill had: a handful of very late events among healthy ones
it('calls out late arrivals and links to the day they were stamped', () => {
  renderStrip({
    ...CLEAN,
    lateCount: 22226,
    maxSeconds: 604800,
    worstTimestamp: '2026-07-18T13:10:37.0000000Z',
    worstIngestedAt: '2026-07-24T23:28:52.0000000Z',
  })

  expect(screen.getByText(/22,226 arrived late/)).toBeDefined()
  expect(screen.getByText(/worst 7d/)).toBeDefined()

  fireEvent.click(screen.getByRole('button'))

  // late events carry old timestamps, so the link has to go to the stamped day,
  // not to when they landed - otherwise it lands on an empty view
  expect(navigate).toHaveBeenCalledWith(
    '/events?from=2026-07-18T00%3A00%3A00Z&to=2026-07-18T23%3A59%3A59Z',
  )
})

it('reports clock skew separately from lateness', () => {
  renderStrip({ ...CLEAN, skewedCount: 5 })

  expect(screen.getByText(/5 stamped ahead of arrival/)).toBeDefined()
})
