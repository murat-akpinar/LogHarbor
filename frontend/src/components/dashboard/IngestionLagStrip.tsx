import { useNavigate } from 'react-router-dom'
import type { IngestionLag } from '../../types'
import { useI18n } from '../../i18n'

/** Seconds -> the coarsest unit that still reads honestly: 45s, 3m, 2h, 7d. */
export function formatLag(seconds: number, t: { s: string; m: string; h: string; d: string }): string {
  const value = Math.max(0, seconds)
  if (value < 60) return `${Math.round(value)}${t.s}`
  if (value < 3600) return `${Math.round(value / 60)}${t.m}`
  if (value < 86400) return `${Math.round(value / 3600)}${t.h}`
  return `${Math.round(value / 86400)}${t.d}`
}

/**
 * A one-line health read on how late events arrived. Deliberately a strip and not another
 * metric card: it matters when it is bad and should cost nothing when it is fine.
 *
 * The late count links to the day the worst event was stamped, which is where late arrivals
 * actually sit — they carry old timestamps, so they are invisible in a "last hour" view no
 * matter how recently they landed.
 */
export function IngestionLagStrip({ lag }: { lag: IngestionLag }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const units = t.dashboard.lagUnits

  if (lag.total === 0) return null

  const hasProblem = lag.lateCount > 0 || lag.skewedCount > 0

  function showWorst() {
    if (!lag.worstTimestamp) return
    const day = lag.worstTimestamp.slice(0, 10)
    navigate(`/events?${new URLSearchParams({
      from: `${day}T00:00:00Z`,
      to: `${day}T23:59:59Z`,
    }).toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-fg-muted">
      <span className="font-medium uppercase tracking-wider">{t.dashboard.ingestionLag}</span>
      <span className="tabular">
        p50 {formatLag(lag.p50Seconds, units)} · p95 {formatLag(lag.p95Seconds, units)} ·{' '}
        {t.dashboard.lagWorst} {formatLag(lag.maxSeconds, units)}
      </span>
      {hasProblem ? (
        <button
          type="button"
          onClick={showWorst}
          disabled={!lag.worstTimestamp}
          className="tabular font-medium text-level-warning transition-colors hover:text-fg disabled:cursor-default disabled:hover:text-level-warning"
        >
          {lag.lateCount > 0 && t.dashboard.lagLate(lag.lateCount.toLocaleString(lang))}
          {lag.lateCount > 0 && lag.skewedCount > 0 && ' · '}
          {lag.skewedCount > 0 && t.dashboard.lagSkewed(lag.skewedCount.toLocaleString(lang))}
          {lag.worstTimestamp && ' →'}
        </button>
      ) : (
        <span>{t.dashboard.lagOnTime}</span>
      )}
    </div>
  )
}
