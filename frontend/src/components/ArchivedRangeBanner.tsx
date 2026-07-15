import { useEffect, useRef, useState } from 'react'
import { getHydrationStatus, startHydration } from '../api/archive'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

const POLL_INTERVAL_MS = 1500

interface ArchivedRangeBannerProps {
  /** Sorted 'YYYY-MM-DD' days reported by the search as archived (cold). */
  archivedDays: string[]
  /** Called when every requested day is extracted, so the search can refetch. */
  onHydrated: () => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function ArchivedRangeBanner({ archivedDays, onHydrated }: ArchivedRangeBannerProps) {
  const { t } = useI18n()
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  async function extract() {
    // hydrate exactly the days the search reported, not the (possibly open) search range
    const from = `${archivedDays[0]}T00:00:00Z`
    const to = `${archivedDays[archivedDays.length - 1]}T23:59:59Z`
    setIsExtracting(true)
    setError(null)
    try {
      await startHydration(from, to)
      while (!cancelledRef.current) {
        await delay(POLL_INTERVAL_MS)
        const { segments } = await getHydrationStatus(from, to)
        const requested = segments.filter((segment) => archivedDays.includes(segment.day))
        if (requested.every((segment) => segment.status === 'hydrated')) {
          onHydrated()
          return
        }
        if (requested.some((segment) => segment.status === 'cold')) {
          // the server returns a failed segment to cold; keep the banner so the user can retry
          throw new Error(t.events.extractionFailed)
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!cancelledRef.current) setIsExtracting(false)
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-level-warning/25 bg-level-warning/10 px-3 py-2 text-fg">
      <p className="text-sm text-fg">
        {t.events.archivedDays(archivedDays.length)}
        {error && <span className="ml-2 text-level-error">{error}</span>}
      </p>
      <Button variant="primary" onClick={() => void extract()} disabled={isExtracting} className="shrink-0">
        {isExtracting ? t.events.extracting : t.events.extract}
      </Button>
    </div>
  )
}
