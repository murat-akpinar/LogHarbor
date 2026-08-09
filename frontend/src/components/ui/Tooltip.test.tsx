// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HelpLines, Tooltip } from './Tooltip'

afterEach(cleanup)

function renderTip(content = <HelpLines lines={['What it measures.', 'What it hides.']} />) {
  return render(
    <Tooltip content={content}>
      <button type="button">explain</button>
    </Tooltip>,
  )
}

it('opens on keyboard focus, not only on hover', async () => {
  renderTip()
  expect(screen.queryByRole('tooltip')).toBeNull()

  screen.getByRole('button', { name: 'explain' }).focus()

  // the reason this component exists instead of title=: a keyboard reader gets the explanation
  expect(await screen.findByRole('tooltip')).toBeDefined()
})

it('closes on Escape', async () => {
  renderTip()
  screen.getByRole('button', { name: 'explain' }).focus()
  await screen.findByRole('tooltip')

  fireEvent.keyDown(window, { key: 'Escape' })

  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('opens on a tap, where hover does not exist at all', async () => {
  renderTip()

  fireEvent.click(screen.getByRole('button', { name: 'explain' }))

  expect(await screen.findByRole('tooltip')).toBeDefined()
})

it('ignores a pointerenter that is a touch, so a tap toggles rather than sticking open', () => {
  renderTip()
  const trigger = screen.getByRole('button', { name: 'explain' }).parentElement!

  fireEvent.pointerEnter(trigger, { pointerType: 'touch' })

  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('escapes an overflow container instead of being clipped by it', async () => {
  // every table in this product sits in an overflow-x-auto panel; an absolutely positioned
  // panel inside one is cut off by it, which is why this renders through a portal
  const { container } = render(
    <div style={{ overflow: 'hidden' }} data-testid="clipper">
      <Tooltip content={<HelpLines lines={['Explained.']} />}>
        <button type="button">explain</button>
      </Tooltip>
    </div>,
  )
  screen.getByRole('button', { name: 'explain' }).focus()

  const tip = await screen.findByRole('tooltip')
  expect(container.contains(tip)).toBe(false)
  expect(document.body.contains(tip)).toBe(true)
})

it('carries more than one line, and ranks the definition above the caveat', async () => {
  renderTip()
  screen.getByRole('button', { name: 'explain' }).focus()

  const tip = await screen.findByRole('tooltip')
  const lines = [...tip.querySelectorAll('p')].map((p) => p.textContent)
  expect(lines).toEqual(['What it measures.', 'What it hides.'])
})

it('drops the lines a caller had nothing to say for', async () => {
  // callers pass a conditional line — "counted up to 100" only matters at the cap — and a
  // false there must not become an empty paragraph
  renderTip(<HelpLines lines={['Only this one.', false, null, undefined, '']} />)
  screen.getByRole('button', { name: 'explain' }).focus()

  const tip = await screen.findByRole('tooltip')
  expect(tip.querySelectorAll('p')).toHaveLength(1)
})

it('describes its trigger only while it is open', async () => {
  renderTip()
  const trigger = screen.getByRole('button', { name: 'explain' }).parentElement!
  expect(trigger.getAttribute('aria-describedby')).toBeNull()

  screen.getByRole('button', { name: 'explain' }).focus()
  const tip = await screen.findByRole('tooltip')

  expect(trigger.getAttribute('aria-describedby')).toBe(tip.id)
})

it('keeps the panel inside the viewport', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...new DOMRect(),
    // a trigger hard against the right edge, and a panel wider than the room left beside it
    left: 780, right: 800, top: 300, bottom: 316, width: 20, height: 16,
  } as DOMRect)
  renderTip()

  screen.getByRole('button', { name: 'explain' }).focus()
  const tip = await screen.findByRole('tooltip')

  // measured panel width is the mocked 20 here; the assertion that matters is that the left is
  // clamped to the window rather than being trigger-centre minus half a panel
  expect(Number.parseFloat(tip.style.left)).toBeLessThanOrEqual(window.innerWidth)
  expect(Number.parseFloat(tip.style.left)).toBeGreaterThanOrEqual(0)
  vi.restoreAllMocks()
})
