import type { AlertRule } from '../types'

/** How often the server evaluates rules (Alerting scheduler). */
const SCHEDULER_TICK_MS = 60_000

/** Whether the rule is silenced right now. An acknowledgement in the past is none — the server
 *  stops honouring it at that instant, so nothing on screen may go on claiming it. */
export function isAcknowledged(rule: AlertRule, now = Date.now()): boolean {
  return rule.acknowledgedUntil !== null && Date.parse(rule.acknowledgedUntil) > now
}

/**
 * Whether the rule is alarming right now, derived rather than stored.
 *
 * A firing rule re-fires every window for as long as its condition holds, so a rule that
 * triggered within its own window is still alarming. The extra scheduler tick is what makes
 * this self-clearing and exact: once the rule has been given a pass in which it *could* have
 * re-fired and did not, the condition has cleared and the alarm is over. No threshold to tune,
 * and nothing to write down — the state expires on its own, wall-clock, in every browser.
 *
 * A failed webhook still counts: lastTriggeredAt records that the condition was met, and an
 * alarm nobody could be told about is the one most worth showing on screen.
 */
export function isFiring(rule: AlertRule, now = Date.now()): boolean {
  if (!rule.isEnabled || rule.lastTriggeredAt === null || isAcknowledged(rule, now)) {
    return false
  }
  const since = now - Date.parse(rule.lastTriggeredAt)
  return since >= 0 && since <= rule.windowMinutes * 60_000 + SCHEDULER_TICK_MS
}

/** The alarming rules, most recently fired first. */
export function firingRules(rules: AlertRule[] | undefined, now = Date.now()): AlertRule[] {
  return (rules ?? [])
    .filter((rule) => isFiring(rule, now))
    .sort((left, right) => Date.parse(right.lastTriggeredAt!) - Date.parse(left.lastTriggeredAt!))
}
