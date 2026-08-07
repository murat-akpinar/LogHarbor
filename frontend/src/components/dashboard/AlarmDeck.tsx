import { Link } from 'react-router-dom'
import type { AlertRule } from '../../types'
import { useAcknowledgeAlert } from '../../hooks/useAlerts'
import { useSignals } from '../../hooks/useSignals'
import { useIsAdmin } from '../../hooks/useAuth'
import { formatRelative } from '../../lib/dates'
import { ACKNOWLEDGE_DURATIONS } from '../../lib/alertDurations'
import { useI18n } from '../../i18n'

interface AlarmDeckProps {
  /** Already filtered to the rules that are alarming, most recently fired first. */
  firing: AlertRule[]
  from: string
  to: string
}

/**
 * What is alarming, at the top of the dashboard, with the two things worth doing about it.
 *
 * The page behind this is dimmed while it is up. That is the whole idea: a dashboard is read
 * top to bottom for context, and when something is actually wrong the context is not the
 * answer — one card is. It disappears by itself when the rule stops firing or is silenced,
 * so nothing here needs dismissing.
 */
export function AlarmDeck({ firing, from, to }: AlarmDeckProps) {
  const { t, lang } = useI18n()
  const isAdmin = useIsAdmin()
  const acknowledge = useAcknowledgeAlert()
  // only fetched while something is alarming: this component is not mounted otherwise
  const { data: signals } = useSignals()

  function signalOf(rule: AlertRule) {
    return signals?.find((signal) => signal.id === rule.signalId)
  }

  return (
    <section
      role="alert"
      className="glass animate-rise rounded-section border border-level-error/30 bg-level-error/[0.07] p-4 shadow-[0_0_40px_-16px_var(--color-level-error)]"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-level-error">
        {/* the one thing on the page allowed to keep moving: an alarm that sits still reads as
            a screenshot of an alarm */}
        <span className="animate-pulse-dot-error size-2 shrink-0 rounded-full bg-level-error" aria-hidden="true" />
        {t.dashboard.alarmTitle(firing.length)}
      </h2>

      <ul className="mt-3 flex flex-col gap-2">
        {firing.map((rule) => {
          const signal = signalOf(rule)
          return (
            <li
              key={rule.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 rounded-well bg-surface-inset px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{rule.title}</p>
                <p className="mt-0.5 truncate text-xs text-fg-muted">
                  {rule.condition === 'silence'
                    ? t.alerts.summarySilence(signal?.title ?? `#${rule.signalId}`, rule.windowMinutes)
                    : t.alerts.summary(signal?.title ?? `#${rule.signalId}`, rule.thresholdCount, rule.windowMinutes)}
                  {rule.lastTriggeredAt && (
                    <span className="text-fg-subtle">
                      {' · '}
                      {t.alerts.lastFired(formatRelative(rule.lastTriggeredAt, lang))}
                    </span>
                  )}
                </p>
                {rule.lastError && <p className="mt-0.5 truncate text-xs text-level-error">{rule.lastError}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* look at it, or silence it — the only two things anybody does at this moment */}
                {signal && (
                  <Link
                    to={`/events?${new URLSearchParams({ from, to, filter: signal.filter }).toString()}`}
                    className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
                  >
                    {t.dashboard.alarmOpenEvents}
                  </Link>
                )}
                {isAdmin && (
                  <span className="flex items-center gap-1 rounded-lg border border-border px-1.5 py-0.5">
                    <span className="text-xs text-fg-subtle">{t.alerts.acknowledge}</span>
                    {ACKNOWLEDGE_DURATIONS.map(({ minutes, label }) => (
                      <button
                        key={minutes}
                        type="button"
                        aria-label={t.alerts.acknowledgeFor(label)}
                        title={t.alerts.acknowledgeFor(label)}
                        disabled={acknowledge.isPending}
                        onClick={() => acknowledge.mutate({ id: rule.id, minutes })}
                        className="rounded px-1.5 py-0.5 font-mono text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {acknowledge.error && <p className="mt-2 text-xs text-level-error">{acknowledge.error.message}</p>}
      <Link to="/alerts" className="mt-2 inline-block text-xs text-fg-muted hover:text-fg">
        {t.dashboard.alarmAllRules} →
      </Link>
    </section>
  )
}
