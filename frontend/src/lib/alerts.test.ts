import { expect, it } from 'vitest'
import type { AlertRule } from '../types'
import { firingRules, isAcknowledged, isFiring } from './alerts'

const NOW = Date.parse('2026-08-08T10:00:00.000Z')

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    title: 'errors-spike',
    signalId: 7,
    filter: null,
    thresholdCount: 10,
    windowMinutes: 5,
    webhookUrl: 'https://example.com/hook',
    isEnabled: true,
    createdAt: '2026-08-08T09:00:00.0000000Z',
    lastTriggeredAt: '2026-08-08T09:58:00.0000000Z', // two minutes ago
    lastError: null,
    payloadFormat: 'generic',
    condition: 'at-least',
    acknowledgedUntil: null,
    acknowledgedBy: null,
    ...over,
  }
}

it('is firing when it triggered inside its own window', () => {
  expect(isFiring(rule(), NOW)).toBe(true)
})

// a firing rule re-fires every window while its condition holds, so one that has had a pass in
// which it could have fired and did not is over -- that is what makes the state self-clearing
it('stops firing once a whole window plus a scheduler tick has passed', () => {
  expect(isFiring(rule({ lastTriggeredAt: '2026-08-08T09:54:30.0000000Z' }), NOW)).toBe(true)
  expect(isFiring(rule({ lastTriggeredAt: '2026-08-08T09:53:30.0000000Z' }), NOW)).toBe(false)
})

it('is not firing when it never fired, or is switched off', () => {
  expect(isFiring(rule({ lastTriggeredAt: null }), NOW)).toBe(false)
  expect(isFiring(rule({ isEnabled: false }), NOW)).toBe(false)
})

// the whole point of acknowledging: the alarm goes quiet on screen as well as on the wire
it('is not firing while it is acknowledged, and is again when that expires', () => {
  expect(isFiring(rule({ acknowledgedUntil: '2026-08-08T11:00:00.0000000Z' }), NOW)).toBe(false)
  expect(isFiring(rule({ acknowledgedUntil: '2026-08-08T09:59:00.0000000Z' }), NOW)).toBe(true)
})

it('reads an acknowledgement in the past as none', () => {
  expect(isAcknowledged(rule({ acknowledgedUntil: '2026-08-08T11:00:00.0000000Z' }), NOW)).toBe(true)
  expect(isAcknowledged(rule({ acknowledgedUntil: '2026-08-08T09:00:00.0000000Z' }), NOW)).toBe(false)
  expect(isAcknowledged(rule(), NOW)).toBe(false)
})

// a rule whose clock is ahead of ours has not fired yet; counting it would make an alarm out
// of a skewed timestamp
it('ignores a trigger stamped in the future', () => {
  expect(isFiring(rule({ lastTriggeredAt: '2026-08-08T10:05:00.0000000Z' }), NOW)).toBe(false)
})

it('lists the alarming rules, most recently fired first', () => {
  const rules = [
    rule({ id: 1, lastTriggeredAt: '2026-08-08T09:57:00.0000000Z' }),
    rule({ id: 2, lastTriggeredAt: '2026-08-08T09:59:00.0000000Z' }),
    rule({ id: 3, isEnabled: false }),
    rule({ id: 4, lastTriggeredAt: '2026-08-08T08:00:00.0000000Z' }),
  ]

  expect(firingRules(rules, NOW).map((item) => item.id)).toEqual([2, 1])
})

it('answers nothing for no rules at all', () => {
  expect(firingRules(undefined, NOW)).toEqual([])
})
