/**
 * How long an operator silences an alarm for.
 *
 * Three, because a list of durations is a decision and the useful ones are "until I have
 * looked", "until after lunch" and "until tomorrow". Shared by the Alerts page and the
 * dashboard's alarm deck, so the two never offer different answers to the same question.
 */
export const ACKNOWLEDGE_DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 60, label: '1h' },
  { minutes: 4 * 60, label: '4h' },
  { minutes: 24 * 60, label: '24h' },
]
