// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { TimeRangeProvider, useLiveRange, useSharedRange } from './useLiveRange'

afterEach(cleanup)

const HOUR_MS = 60 * 60 * 1000

/** Stands in for a stats page: it needs both ends closed. */
function ClosedRangeProbe({ id }: { id: string }) {
  const { live, range, setRange, toggleLive } = useLiveRange()
  return (
    <div>
      <span data-testid={`${id}-from`}>{range.from}</span>
      <span data-testid={`${id}-to`}>{range.to}</span>
      <span data-testid={`${id}-live`}>{String(live)}</span>
      <button onClick={() => setRange({ from: '2020-01-01T00:00:00.000Z', to: undefined })}>
        pick {id}
      </button>
      <button onClick={toggleLive}>toggle {id}</button>
    </div>
  )
}

/** Stands in for Events, which may search without bounds. */
function OpenRangeProbe() {
  const { range } = useSharedRange()
  return <span data-testid="open-from">{range.from ?? 'none'}</span>
}

// live by default, so the hour keeps rolling; paused, it froze at whatever moment the app
// mounted and a tab left open drifted hours behind without saying so
it('opens live, on the last hour', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
    </TimeRangeProvider>,
  )

  expect(screen.getByTestId('a-live').textContent).toBe('true')
  const from = new Date(screen.getByTestId('a-from').textContent!).getTime()
  const to = new Date(screen.getByTestId('a-to').textContent!).getTime()
  // an hour wide, give or take the tick the window is floored to
  expect(to - from).toBeGreaterThanOrEqual(HOUR_MS - 20_000)
  expect(to - from).toBeLessThanOrEqual(HOUR_MS + 20_000)
})

// the point of the whole provider: narrowing the window on one page and clicking through to
// another used to land you back on the default with nothing to say what you had been looking at
it('carries a range picked by one page to every other page', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
      <ClosedRangeProbe id="b" />
      <OpenRangeProbe />
    </TimeRangeProvider>,
  )

  screen.getByText('pick a').click()

  await waitFor(() => {
    expect(screen.getByTestId('b-from').textContent).toBe('2020-01-01T00:00:00.000Z')
  })
  expect(screen.getByTestId('a-from').textContent).toBe('2020-01-01T00:00:00.000Z')
  expect(screen.getByTestId('open-from').textContent).toBe('2020-01-01T00:00:00.000Z')
})

it('shares live mode too, and picking a range leaves it', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
      <ClosedRangeProbe id="b" />
    </TimeRangeProvider>,
  )

  // pausing on one page pauses on all of them
  screen.getByText('toggle a').click()
  await waitFor(() => expect(screen.getByTestId('b-live').textContent).toBe('false'))

  screen.getByText('toggle b').click()
  await waitFor(() => expect(screen.getByTestId('a-live').textContent).toBe('true'))

  // and an explicit range contradicts "now", so it drops out of live everywhere
  screen.getByText('pick b').click()
  await waitFor(() => expect(screen.getByTestId('a-live').textContent).toBe('false'))
})

// an explicit initialRange means "start here", which contradicts live for the same reason
// picking a range does — so a page that draws a rate still gets two bounds
it('closes an open end for pages that cannot take one', () => {
  render(
    <TimeRangeProvider initialRange={{ from: undefined, to: undefined }}>
      <ClosedRangeProbe id="a" />
      <OpenRangeProbe />
    </TimeRangeProvider>,
  )

  expect(screen.getByTestId('open-from').textContent).toBe('none')
  const from = new Date(screen.getByTestId('a-from').textContent!).getTime()
  const to = new Date(screen.getByTestId('a-to').textContent!).getTime()
  expect(Number.isFinite(from)).toBe(true)
  expect(to - from).toBeGreaterThanOrEqual(HOUR_MS - 20_000)
})

it('refuses to work outside its provider, rather than inventing a window', () => {
  // React logs the thrown error; the assertion is what matters
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() => render(<ClosedRangeProbe id="a" />)).toThrow(/TimeRangeProvider/)
  quiet.mockRestore()
})
