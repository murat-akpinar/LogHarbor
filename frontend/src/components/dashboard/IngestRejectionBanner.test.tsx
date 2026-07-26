// @vitest-environment jsdom
import { afterEach, expect, it, describe } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../i18n'
import type { IngestRejection } from '../../types'
import { IngestRejectionBanner } from './IngestRejectionBanner'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const REJECTION: IngestRejection = {
  apiKeyId: 3,
  apiKeyTitle: 'shipping-service',
  reason: 'invalid_payload',
  day: '2026-07-26',
  requestCount: 412,
  firstSeen: '2026-07-26T08:00:00.0000000Z',
  lastSeen: '2026-07-26T11:30:45.0000000Z',
  lastDetail: 'line 1: missing or unparseable @t',
}

function show(rejections: IngestRejection[], totalRequests = 412) {
  render(
    <LanguageProvider>
      <IngestRejectionBanner rejections={rejections} totalRequests={totalRequests} days={7} />
    </LanguageProvider>,
  )
}

describe('IngestRejectionBanner', () => {
  it('stays out of the way when nothing was rejected', () => {
    const { container } = render(
      <LanguageProvider>
        <IngestRejectionBanner rejections={[]} totalRequests={0} days={7} />
      </LanguageProvider>,
    )

    expect(container.innerHTML).toBe('')
  })

  it('names the reason, the count and the key that was turned away', () => {
    show([REJECTION])

    expect(screen.getByText('Unparseable payload')).toBeTruthy()
    expect(screen.getByText('×412')).toBeTruthy()
    expect(screen.getByText('shipping-service')).toBeTruthy()
  })

  it('shows the last error detail, which is what identifies the broken client', () => {
    show([REJECTION])

    expect(screen.getByText('line 1: missing or unparseable @t')).toBeTruthy()
  })

  it('says so plainly when the request had no valid key', () => {
    show([{ ...REJECTION, apiKeyId: 0, apiKeyTitle: null, reason: 'unauthorized' }])

    expect(screen.getByText('Rejected key')).toBeTruthy()
    expect(screen.getByText('no valid API key')).toBeTruthy()
  })

  it('lists one row per bucket', () => {
    show([
      REJECTION,
      { ...REJECTION, reason: 'rate_limited', day: '2026-07-25', requestCount: 9 },
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Rate limited')).toBeTruthy()
  })
})
