import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getHydrationStatus, startHydration } from '../api/archive'
import { formatBytes } from '../lib/bytes'
import { useI18n } from '../i18n'
import type { ArchiveSegment } from '../types'
import { Button } from './ui/Button'

const POLL_INTERVAL_MS = 1500

const TH_CLASS = 'pb-2 font-medium'
const TD_CLASS = 'py-2 text-fg'

interface ArchiveSegmentsProps {
  /** Every compressed day the server knows about, newest first. */
  segments: ArchiveSegment[]
  /** Admins may extract; viewers only read the list. */
  canExtract: boolean
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The archived days, each extractable on demand. Search covers hot and already-extracted
 * data only, so this list is where a cold day is brought back — it used to be a banner on
 * the Events page, which meant the notice competed with the results it was talking about.
 */
export function ArchiveSegments({ segments, canExtract }: ArchiveSegmentsProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [extractingDay, setExtractingDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  async function extract(day: string) {
    const from = `${day}T00:00:00Z`
    const to = `${day}T23:59:59Z`
    setExtractingDay(day)
    setError(null)
    try {
      await startHydration(from, to)
      while (!cancelledRef.current) {
        await delay(POLL_INTERVAL_MS)
        const { segments: requested } = await getHydrationStatus(from, to)
        if (requested.every((segment) => segment.status === 'hydrated')) {
          await queryClient.invalidateQueries({ queryKey: ['archive-segments'] })
          await queryClient.invalidateQueries({ queryKey: ['events'] })
          return
        }
        if (requested.some((segment) => segment.status === 'cold')) {
          // the server returns a failed segment to cold; keep the row actionable so it can retry
          throw new Error(t.settings.extractionFailed)
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!cancelledRef.current) setExtractingDay(null)
    }
  }

  if (segments.length === 0) {
    return <p className="text-sm text-fg-muted">{t.settings.noArchivedDays}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted">{t.settings.archivedDaysHint}</p>
      {error && <p className="text-xs text-level-error">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-fg-muted">
            <th className={TH_CLASS}>{t.settings.colDay}</th>
            <th className={TH_CLASS}>{t.settings.colEvents}</th>
            <th className={TH_CLASS}>{t.settings.colSize}</th>
            <th className={TH_CLASS}>{t.settings.colStatus}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={segment.day} className="border-b border-border last:border-b-0">
              <td className={`${TD_CLASS} tabular`}>{segment.day}</td>
              <td className={`${TD_CLASS} tabular`}>{segment.eventCount}</td>
              <td className={`${TD_CLASS} tabular`}>{formatBytes(segment.sizeBytes)}</td>
              <td className="py-2">
                <span className={segment.status === 'hydrated' ? 'text-accent' : 'text-fg-muted'}>
                  {t.settings.segmentStatus[segment.status]}
                </span>
              </td>
              <td className="py-2 text-right">
                {canExtract && segment.status === 'cold' && (
                  <Button
                    variant="primary"
                    onClick={() => void extract(segment.day)}
                    disabled={extractingDay !== null}
                  >
                    {extractingDay === segment.day ? t.settings.extracting : t.settings.extract}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
