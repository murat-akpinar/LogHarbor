import type { IngestRejection } from '../../types'
import { useI18n } from '../../i18n'

/**
 * The events that never made it. A rejected ingestion request is invisible by design —
 * the client keeps its 4xx to itself and drops the batch — so this is the only place the
 * loss shows up without reading server logs.
 *
 * Renders nothing when there is nothing wrong: a healthy install must not carry an empty
 * "no rejections" panel around forever, or the panel stops meaning anything when it fills.
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

  if (rejections.length === 0) return null

  return (
    <section
      aria-labelledby="ingest-rejections-heading"
      className="rounded-lg border border-level-error/40 bg-level-error/5 p-4"
    >
      <h2
        id="ingest-rejections-heading"
        className="text-xs font-medium uppercase tracking-wider text-level-error"
      >
        {strings.rejectedTitle}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {strings.rejectedLead(totalRequests.toLocaleString(lang), String(days))}
      </p>
      <ul className="mt-3 space-y-2">
        {rejections.map((rejection) => (
          <li
            key={`${rejection.apiKeyId}-${rejection.reason}-${rejection.day}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
          >
            <span className="font-medium text-fg">
              {strings.rejectedReasons[rejection.reason] ?? rejection.reason}
            </span>
            <span className="tabular text-fg-muted">
              &times;{rejection.requestCount.toLocaleString(lang)}
            </span>
            <span className="text-fg-muted">
              {strings.rejectedFrom}{' '}
              <span className="text-fg">{rejection.apiKeyTitle ?? strings.rejectedNoKey}</span>
            </span>
            <span className="tabular text-xs text-fg-muted">
              {strings.rejectedLastSeen} {rejection.lastSeen.slice(0, 19).replace('T', ' ')}
            </span>
            {rejection.lastDetail && (
              // the client's own payload can reach this string; React escapes it (rules.md)
              <span className="w-full truncate font-mono text-xs text-fg-muted">
                {rejection.lastDetail}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
