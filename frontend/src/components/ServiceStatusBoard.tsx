import { formatAge } from '../lib/dates'
import { useI18n } from '../i18n'
import type { ServiceStatusRow } from '../types'
import { Card } from './ui/Card'

interface ServiceStatusBoardProps {
  /** Host services as the probe last reported them, worst first (the server orders them). */
  services: ServiceStatusRow[]
  onOpen: (row: ServiceStatusRow) => void
}

/**
 * Filled dot = the probe got an answer, hollow = it did not (no heartbeat, or it could not ask).
 * The status word is next to it either way: colour alone must not carry the meaning.
 */
const DOT_CLASS: Record<ServiceStatusRow['status'], string> = {
  up: 'bg-accent',
  down: 'bg-level-error',
  unhealthy: 'bg-level-warning',
  stale: 'border-2 border-level-warning',
  unknown: 'border-2 border-fg-subtle',
}

const LABEL_CLASS: Record<ServiceStatusRow['status'], string> = {
  up: 'text-fg-muted',
  down: 'text-level-error',
  unhealthy: 'text-level-warning',
  stale: 'text-level-warning',
  unknown: 'text-fg-subtle',
}

/**
 * Up/down for the host's own services (systemd units, Docker containers), read straight out of
 * the events tools/service-probe sends. Nothing renders when no probe has ever reported, so an
 * install without one keeps the page it had.
 */
export function ServiceStatusBoard({ services, onOpen }: ServiceStatusBoardProps) {
  const { t, lang } = useI18n()
  if (services.length === 0) return null

  const hosts = [...new Set(services.map((row) => row.host))]

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">{t.services.statusTitle}</h2>
        <p className="text-xs text-fg-muted">{t.services.statusHint}</p>
      </div>

      {hosts.map((host) => {
        const rows = services.filter((row) => row.host === host)
        const notUp = rows.filter((row) => row.status !== 'up').length
        return (
          <section key={host} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-mono text-sm text-fg">{host}</h3>
              <span className={`text-xs ${notUp > 0 ? 'text-level-error' : 'text-fg-muted'}`}>
                {notUp > 0 ? t.services.statusNotUpCount(notUp) : t.services.statusUpCount(rows.length)}
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
              {rows.map((row) => (
                <button
                  key={`${row.host}/${row.service}`}
                  type="button"
                  onClick={() => onOpen(row)}
                  className="flex flex-col gap-1 rounded-card border border-border p-2 text-left hover:bg-surface-hover"
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[row.status]}`} />
                    <span className="truncate font-mono text-sm text-fg">{row.service}</span>
                    <span className={`ml-auto text-xs ${LABEL_CLASS[row.status]}`}>
                      {t.services.status[row.status]}
                    </span>
                  </span>
                  <span className="truncate pl-[1.125rem] text-xs text-fg-muted">
                    {[row.kind, row.state, formatAge(row.secondsSinceLastSeen, lang)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </Card>
  )
}
