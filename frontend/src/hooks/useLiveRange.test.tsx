// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

// whoever has set nothing gets the last hour and no stream, and turns the stream on themselves
it('opens on the last hour, not live', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
    </TimeRangeProvider>,
  )

  expect(screen.getByTestId('a-live').textContent).toBe('false')
  const from = new Date(screen.getByTestId('a-from').textContent!).getTime()
  const to = new Date(screen.getByTestId('a-to').textContent!).getTime()
  // an hour wide, give or take the tick the window is floored to
  expect(to - from).toBeGreaterThanOrEqual(HOUR_MS - 20_000)
  expect(to - from).toBeLessThanOrEqual(HOUR_MS + 20_000)
})

// the reason the default used to be live: not-live meant frozen, so opening paused pinned the
// window to the moment of sign-in and a tab left open drifted hours behind without saying so
it('keeps rolling while paused, until something is actually picked', async () => {
  vi.useFakeTimers()
  try {
    render(
      <TimeRangeProvider>
        <ClosedRangeProbe id="a" />
      </TimeRangeProvider>,
    )
    const opened = new Date(screen.getByTestId('a-to').textContent!).getTime()

    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    const later = new Date(screen.getByTestId('a-to').textContent!).getTime()
    expect(later).toBeGreaterThan(opened)
  } finally {
    vi.useRealTimers()
  }
})

// but a real pause does freeze: that is the only thing the button means once the reader has
// used it, and a window that kept moving under a reader who asked it to stop would be a lie
it('holds the window still once live has been turned on and off again', async () => {
  vi.useFakeTimers()
  try {
    render(
      <TimeRangeProvider>
        <ClosedRangeProbe id="a" />
      </TimeRangeProvider>,
    )

    await act(async () => {
      screen.getByText('toggle a').click() // live
    })
    await act(async () => {
      screen.getByText('toggle a').click() // paused, on whatever was on screen
    })
    const paused = screen.getByTestId('a-to').textContent

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByTestId('a-to').textContent).toBe(paused)
  } finally {
    vi.useRealTimers()
  }
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

  // going live on one page goes live on all of them
  screen.getByText('toggle a').click()
  await waitFor(() => expect(screen.getByTestId('b-live').textContent).toBe('true'))

  // and so does pausing again
  screen.getByText('toggle b').click()
  await waitFor(() => expect(screen.getByTestId('a-live').textContent).toBe('false'))

  // and an explicit range contradicts "now", so it drops out of live everywhere. Turned back
  // on first, or this would assert a flag that was already false and prove nothing.
  screen.getByText('toggle a').click()
  await waitFor(() => expect(screen.getByTestId('b-live').textContent).toBe('true'))
  screen.getByText('pick b').click()
  await waitFor(() => expect(screen.getByTestId('a-live').textContent).toBe('false'))
})

// an explicit initialRange means "start here": a window that was picked, not the rolling
// default — so a page that draws a rate still gets two bounds
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
