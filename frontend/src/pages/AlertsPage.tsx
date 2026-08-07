import { useState } from 'react'
import type { AlertRule } from '../types'
import { useAcknowledgeAlert, useAlerts, useCreateAlert, useDeleteAlert, useUpdateAlert } from '../hooks/useAlerts'
import { useSignals } from '../hooks/useSignals'
import { useIsAdmin } from '../hooks/useAuth'
import { formatTimestamp } from '../lib/dates'
import { ACKNOWLEDGE_DURATIONS } from '../lib/alertDurations'
import { isAcknowledged } from '../lib/alerts'
import { AlertForm } from '../components/AlertForm'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/States'
import { Button } from '../components/ui/Button'
import { useI18n } from '../i18n'

function AlertRow({ alert, signalTitle, isAdmin }: { alert: AlertRule; signalTitle: string; isAdmin: boolean }) {
  const { t, lang } = useI18n()
  const [isEditing, setIsEditing] = useState(false)
  const updateAlert = useUpdateAlert()
  const deleteAlert = useDeleteAlert()
  const acknowledge = useAcknowledgeAlert()
  // an acknowledgement in the past is none: the server stops honouring it at that instant and
  // the row must not go on claiming a silence that has run out
  const silencedUntil = isAcknowledged(alert) ? alert.acknowledgedUntil : null

  if (isEditing) {
    return (
      <div className="border-b border-border p-3 last:border-b-0">
        <AlertForm
          initial={{
            title: alert.title,
            signalId: alert.signalId,
            thresholdCount: alert.thresholdCount,
            windowMinutes: alert.windowMinutes,
            webhookUrl: alert.webhookUrl,
            payloadFormat: alert.payloadFormat,
            isEnabled: alert.isEnabled,
            condition: alert.condition,
          }}
          submitLabel={t.common.save}
          onCancel={() => setIsEditing(false)}
          onSubmit={async (request) => {
            await updateAlert.mutateAsync({ id: alert.id, request })
            setIsEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className="border-b border-border p-3 text-sm last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium text-fg">{alert.title}</span>
          <span className={`ml-2 text-xs ${alert.isEnabled ? 'text-accent' : 'text-fg-muted'}`}>
            {alert.isEnabled ? t.alerts.enabled : t.alerts.disabled}
          </span>
          <div className="mt-0.5 truncate text-xs text-fg-muted">
            {alert.condition === 'silence'
              ? t.alerts.summarySilence(signalTitle, alert.windowMinutes)
              : t.alerts.summary(signalTitle, alert.thresholdCount, alert.windowMinutes)}{' '}
            <span className="font-mono">{alert.webhookUrl}</span>
          </div>
          {alert.lastTriggeredAt && (
            <div className="mt-0.5 text-xs text-fg-muted">{t.alerts.lastFired(formatTimestamp(alert.lastTriggeredAt, lang))}</div>
          )}
          {silencedUntil && (
            <div className="mt-1 inline-flex items-center gap-1 rounded bg-level-warning/12 px-1.5 py-0.5 text-xs text-level-warning">
              {t.alerts.acknowledgedUntil(formatTimestamp(silencedUntil, lang))}
              {alert.acknowledgedBy && <span>{t.alerts.acknowledgedBy(alert.acknowledgedBy)}</span>}
            </div>
          )}
          {alert.lastError && <div className="mt-0.5 text-xs text-level-error">{alert.lastError}</div>}
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            {/* silencing is not disabling: the rule keeps its schedule and starts paging again
                by itself, which is what makes it safe to reach for at 3am */}
            {silencedUntil ? (
              <Button
                variant="secondary"
                title={t.alerts.resumeHint}
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate({ id: alert.id, minutes: null })}
              >
                {t.alerts.resume}
              </Button>
            ) : (
              <span className="flex items-center gap-1 rounded-lg border border-border px-1.5 py-0.5">
                <span className="text-xs text-fg-subtle">{t.alerts.acknowledge}</span>
                {ACKNOWLEDGE_DURATIONS.map(({ minutes, label }) => (
                  <button
                    key={minutes}
                    type="button"
                    // the visible label is a duration; the name a screen reader reads has to be
                    // the whole action, and it is what a test can hold the button by
                    aria-label={t.alerts.acknowledgeFor(label)}
                    title={t.alerts.acknowledgeFor(label)}
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledge.mutate({ id: alert.id, minutes })}
                    className="rounded px-1.5 py-0.5 font-mono text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
            <Button variant="ghost" onClick={() => setIsEditing(true)}>
              {t.common.edit}
            </Button>
            <Button variant="danger" onClick={() => deleteAlert.mutate(alert.id)} disabled={deleteAlert.isPending}>
              {t.common.delete}
            </Button>
          </div>
        )}
      </div>
      {deleteAlert.error && <p className="mt-1 text-xs text-level-error">{deleteAlert.error.message}</p>}
      {acknowledge.error && <p className="mt-1 text-xs text-level-error">{acknowledge.error.message}</p>}
    </div>
  )
}

export function AlertsPage() {
  const { t } = useI18n()
  const { data: alerts, isLoading, error, refetch } = useAlerts()
  const { data: signals } = useSignals()
  const createAlert = useCreateAlert()
  const isAdmin = useIsAdmin()

  const signalTitle = (signalId: number) => signals?.find((signal) => signal.id === signalId)?.title ?? `#${signalId}`

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t.alerts.title}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-muted">{t.alerts.description}</p>
      </div>

      {isAdmin && (
        <SectionBlock icon="alerts" title={t.alerts.newRule} index={0}>
          <Panel className="p-4">
            <AlertForm submitLabel={t.common.create} onSubmit={(request) => createAlert.mutateAsync(request)} />
          </Panel>
        </SectionBlock>
      )}

      {/* headerless: the page's own h1 already names the one list on it */}
      <SectionBlock index={1}>
        <Panel className="overflow-hidden">
          {isLoading && (
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          )}
          {error && <ErrorState className="m-3" message={error.message} onRetry={() => refetch()} />}
          {alerts && alerts.length === 0 && <EmptyState icon="alerts" title={t.alerts.noAlerts} />}
          {alerts?.map((alert) => (
            <AlertRow key={alert.id} alert={alert} signalTitle={signalTitle(alert.signalId)} isAdmin={isAdmin} />
          ))}
        </Panel>
      </SectionBlock>
    </div>
  )
}
