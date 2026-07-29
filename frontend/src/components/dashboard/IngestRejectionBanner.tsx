import type { IngestRejection } from '../../types'
import { useI18n } from '../../i18n'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { Button } from '../ui/Button'

/** The newest rejection the operator has already seen; anything after it opens the banner again. */
const DISMISSED_KEY = 'logharbor-rejections-dismissed'

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-fg-subtle">{label}</span>
      <span className={`truncate text-fg ${mono ? 'font-mono' : ''}`}>{value}</span>
    </span>
  )
}

/**
 * The events that never made it. A rejected ingestion request is invisible by design —
 * the client keeps its 4xx to itself and drops the batch — so this is the only place the
 * loss shows up without reading server logs.
 *
 * Renders nothing when there is nothing wrong: a healthy install must not carry an empty
 * "no rejections" panel around forever, or the panel stops meaning anything when it fills.
 * Dismissing works the same way — it hides what has been read, not the next thing to go wrong.
 */
export function IngestRejectionBanner({
  rejections,
  totalRequests,
  days,
}: {
  rejections: IngestRejection[]
  totalRequests: number
  days: number
}) {
  const { t, lang } = useI18n()
  const strings = t.dashboard
  const [dismissedAt, setDismissedAt] = useLocalStorage<string | null>(DISMISSED_KEY, null)

  if (rejections.length === 0) return null

  // the API orders by last_seen, but the newest is what dismissal is measured against, so it is
  // computed rather than assumed
  const newest = rejections.reduce((latest, rejection) => (rejection.lastSeen > latest ? rejection.lastSeen : latest), '')
  if (dismissedAt !== null && newest <= dismissedAt) return null

  return (
    <section
      aria-labelledby="ingest-rejections-heading"
      className="rounded-lg border border-level-error/40 bg-level-error/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="ingest-rejections-heading"
            className="text-xs font-medium tracking-wider text-level-error uppercase"
          >
            {strings.rejectedTitle}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {strings.rejectedLead(totalRequests.toLocaleString(lang), String(days))}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setDismissedAt(newest)}
          title={strings.rejectedDismissHint}
          className="shrink-0 px-2 py-1 text-xs"
        >
          {strings.rejectedDismiss}
        </Button>
      </div>

      <ul className="mt-3 space-y-2">
        {rejections.map((rejection) => (
          <li
            key={`${rejection.apiKeyId}-${rejection.reason}-${rejection.day}`}
            className="border-t border-level-error/20 pt-2 first:border-t-0 first:pt-0"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-fg">
                {strings.rejectedReasons[rejection.reason] ?? rejection.reason}
              </span>
              <span className="tabular text-fg-muted">&times;{rejection.requestCount.toLocaleString(lang)}</span>
              <span className="tabular ml-auto text-xs text-fg-subtle">
                {rejection.firstSeen.slice(11, 19)} → {rejection.lastSeen.slice(0, 19).replace('T', ' ')} UTC
              </span>
            </div>

            {/* what the reason means and what to do about it: the label alone sends people to the docs */}
            <p className="mt-0.5 text-xs text-fg-muted">{strings.rejectedExplain[rejection.reason]}</p>

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              <Fact label={strings.rejectedKeyLabel} value={rejection.apiKeyTitle ?? strings.rejectedNoKey} />
              {rejection.lastClient && <Fact label={strings.rejectedClientLabel} value={rejection.lastClient} mono />}
              {rejection.lastUserAgent && <Fact label={strings.rejectedAgentLabel} value={rejection.lastUserAgent} mono />}
            </div>

            {rejection.lastDetail && (
              // the client's own payload can reach this string; React escapes it (rules.md)
              <p className="mt-1 font-mono text-xs break-words text-fg-muted">{rejection.lastDetail}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
