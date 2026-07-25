import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getHydrationStatus, startHydration } from '../api/archive'
import { useI18n } from '../i18n'

const POLL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000

/**
 * The API reports which days of a range live in cold storage (`archivedDays`), and without this
 * the page just renders an empty list — the events exist, compressed on disk, and nothing said so.
 * Bounds come from the days themselves rather than the page's range, so this works for an
 * open-ended range too.
 */
export function ArchivedDaysBanner({ days }: { days: string[] }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')

  if (days.length === 0) return null

  const sorted = [...days].sort()
  const from = `${sorted[0]}T00:00:00Z`
  const to = `${sorted[sorted.length - 1]}T23:59:59Z`

  async function extract() {
    setState('working')
    try {
      await startHydration(from, to)
      await waitForHydration(from, to)
      // the rows are in events_cache now, so every range-scoped read can see them
      await queryClient.invalidateQueries()
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-level-warning/10 px-3 py-1.5 text-sm text-fg">
      <span>{t.events.archivedDays(days.length)}</span>
      <span className="font-mono text-xs text-fg-muted">{sorted.join(', ')}</span>
      {state === 'working' ? (
        <span className="text-xs text-fg-muted">{t.events.extractingArchived}</span>
      ) : (
        <button
          type="button"
          onClick={extract}
          className="rounded-lg bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-hover"
        >
          {t.events.extractArchived}
        </button>
      )}
      {state === 'failed' && <span className="text-xs text-level-error">{t.events.extractArchivedFailed}</span>}
    </div>
  )
}

/** Hydration runs on a background worker, so the POST only queues it. */
async function waitForHydration(from: string, to: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const status = await getHydrationStatus(from, to)
    if (!status.segments.some((segment) => segment.status === 'hydrating')) return
  }
}
