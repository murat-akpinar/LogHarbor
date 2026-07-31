import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { Event } from '../../types'
import { getEvents } from '../../api/events'
import { LevelBadge } from '../LevelBadge'
import { formatTimestamp } from '../../lib/dates'
import { exceptionStartsWith, quote } from '../../lib/filter'
import { useI18n } from '../../i18n'

interface ExceptionContextPanelProps {
  type: string
  from: string
  to: string
}

/** Inline context for one exception group: its latest occurrence plus the same-trace events around it. */
export function ExceptionContextPanel({ type, from, to }: ExceptionContextPanelProps) {
  const { t, lang } = useI18n()

  const latestQuery = useQuery({
    queryKey: ['exception-context', type, from, to],
    queryFn: () => getEvents({ filter: exceptionStartsWith(type), from, to, count: 1 }),
  })
  const latest: Event | undefined = latestQuery.data?.events[0]

  const traceQuery = useQuery({
    queryKey: ['trace', latest?.traceId],
    queryFn: () => getEvents({ filter: `@TraceId = ${quote(latest!.traceId!)}`, count: 1000 }),
    enabled: Boolean(latest?.traceId),
  })
  // the API returns newest first; the story reads top-down in time order
  const traceEvents = [...(traceQuery.data?.events ?? [])].reverse()

  if (latestQuery.isLoading) return <p className="p-3 text-sm text-fg-muted">{t.common.loading}</p>
  if (!latest) return null

  return (
    <div className="flex flex-col gap-3 bg-surface p-3">
      <div>
        <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t.exceptions.latestOccurrence}</p>
        <p className="mt-1 text-sm text-fg">
          <span className="mr-2 whitespace-nowrap text-fg-muted">{formatTimestamp(latest.timestamp, lang)}</span>
          {latest.message}
        </p>
        {latest.exception && (
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-inset p-2 text-xs whitespace-pre-wrap text-fg">
            {latest.exception}
          </pre>
        )}
      </div>
      {latest.traceId ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t.exceptions.sameTrace}</p>
            <Link
              to={`/events?${new URLSearchParams({ filter: `@TraceId = ${quote(latest.traceId)}` }).toString()}`}
              className="text-xs text-fg-muted transition-colors hover:text-accent"
            >
              {t.exceptions.viewFullTrace} ↗
            </Link>
          </div>
          <ul className="mt-1 max-h-64 overflow-y-auto">
            {traceEvents.map((event) => (
              <li
                key={event.id}
                className={`flex items-baseline gap-2 border-b border-border px-1 py-1 text-sm last:border-b-0 ${
                  event.id === latest.id ? 'bg-surface-raised' : ''
                }`}
              >
                <span className="whitespace-nowrap text-xs text-fg-muted">{formatTimestamp(event.timestamp, lang)}</span>
                <LevelBadge level={event.level} />
                <span className="min-w-0 truncate text-fg">{event.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t.exceptions.noTraceContext}</p>
      )}
    </div>
  )
}
