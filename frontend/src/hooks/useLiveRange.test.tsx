// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { TimeRangeProvider, useLiveRange, useSharedRange } from './useLiveRange'

afterEach(cleanup)

const HOUR_MS = 60 * 60 * 1000

/** Stands in for a stats page: it needs both ends closed. */
function ClosedRangeProbe({ id }: { id: string }) {
  const { live, range, presetKey, setRange, setPreset, toggleLive } = useLiveRange()
  return (
    <div>
      <span data-testid={`${id}-from`}>{range.from}</span>
      <span data-testid={`${id}-to`}>{range.to}</span>
      <span data-testid={`${id}-live`}>{String(live)}</span>
      <span data-testid={`${id}-preset`}>{presetKey ?? 'none'}</span>
      <button onClick={() => setRange({ from: '2020-01-01T00:00:00.000Z', to: undefined })}>
        pick {id}
      </button>
      <button onClick={() => setPreset('last6h')}>preset {id}</button>
      <button onClick={toggleLive}>toggle {id}</button>
    </div>
  )
}

/** Stands in for Events, which may search without bounds. */
function OpenRangeProbe() {
  const { range } = useSharedRange()
  return <span data-testid="open-from">{range.from ?? 'none'}</span>
}

// whoever has set nothing gets the last hour, streaming — including after a reload, which is
// where a default of "off" was felt: every F5 landed on a log viewer with nothing moving on it
it('opens on the last hour, live', async () => {
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

// the window nobody has picked follows the clock, so a tab left open over lunch does not sit
// on the hour before it with nothing on the page to say so
it('keeps the opening window rolling with the clock', async () => {
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
it('holds the window still once live has been turned off', async () => {
  vi.useFakeTimers()
  try {
    render(
      <TimeRangeProvider>
        <ClosedRangeProbe id="a" />
      </TimeRangeProvider>,
    )

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

// the visible half of "keep my choice between pages": the other page has to say "Last 6 hours"
// too, not print the two dates the preset happened to cover when it was clicked
it('carries the preset itself, not just the two dates it works out to', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
      <ClosedRangeProbe id="b" />
    </TimeRangeProvider>,
  )

  expect(screen.getByTestId('a-preset').textContent).toBe('lastHour')

  screen.getByText('preset a').click()

  await waitFor(() => expect(screen.getByTestId('b-preset').textContent).toBe('last6h'))
  const from = new Date(screen.getByTestId('b-from').textContent!).getTime()
  const to = new Date(screen.getByTestId('b-to').textContent!).getTime()
  expect(to - from).toBe(6 * HOUR_MS)

  // and two ends by hand are not a preset, so the label falls back to the dates
  screen.getByText('pick b').click()
  await waitFor(() => expect(screen.getByTestId('a-preset').textContent).toBe('none'))
})

// a preset that recorded two dates at click time drifted away from its own label; this is the
// assertion that it follows now instead
it('keeps a preset rolling as time passes', async () => {
  vi.useFakeTimers()
  try {
    render(
      <TimeRangeProvider>
        <ClosedRangeProbe id="a" />
      </TimeRangeProvider>,
    )
    await act(async () => {
      screen.getByText('preset a').click()
    })
    const first = new Date(screen.getByTestId('a-to').textContent!).getTime()

    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    const second = new Date(screen.getByTestId('a-to').textContent!).getTime()
    expect(second).toBeGreaterThan(first)
    // still six hours wide, still called that
    const from = new Date(screen.getByTestId('a-from').textContent!).getTime()
    expect(second - from).toBe(6 * HOUR_MS)
    expect(screen.getByTestId('a-preset').textContent).toBe('last6h')
  } finally {
    vi.useRealTimers()
  }
})

// pausing on a six-hour window and resuming used to drop back to an hour without saying so
it('resumes at the width it was paused on', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
    </TimeRangeProvider>,
  )

  screen.getByText('preset a').click()
  await waitFor(() => expect(screen.getByTestId('a-preset').textContent).toBe('last6h'))

  screen.getByText('toggle a').click() // paused: the window is two dates now
  await waitFor(() => expect(screen.getByTestId('a-preset').textContent).toBe('none'))
  screen.getByText('toggle a').click() // live again

  await waitFor(() => expect(screen.getByTestId('a-preset').textContent).toBe('last6h'))
  const from = new Date(screen.getByTestId('a-from').textContent!).getTime()
  const to = new Date(screen.getByTestId('a-to').textContent!).getTime()
  expect(to - from).toBe(6 * HOUR_MS)
})

it('shares live mode too, and picking a range leaves it', async () => {
  render(
    <TimeRangeProvider>
      <ClosedRangeProbe id="a" />
      <ClosedRangeProbe id="b" />
    </TimeRangeProvider>,
  )

  // pausing on one page pauses all of them
  screen.getByText('toggle a').click()
  await waitFor(() => expect(screen.getByTestId('b-live').textContent).toBe('false'))

  // and so does going live again
  screen.getByText('toggle b').click()
  await waitFor(() => expect(screen.getByTestId('a-live').textContent).toBe('true'))

  // and an explicit range contradicts "now", so it drops out of live everywhere — asserted
  // from live, or this would prove nothing about a flag that was already false
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
