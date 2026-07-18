import { useState } from 'react'
import type { AlertRule } from '../types'
import { useAlerts, useCreateAlert, useDeleteAlert, useUpdateAlert } from '../hooks/useAlerts'
import { useSignals } from '../hooks/useSignals'
import { useIsAdmin } from '../hooks/useAuth'
import { formatTimestamp } from '../lib/dates'
import { AlertForm } from '../components/AlertForm'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useI18n } from '../i18n'

function AlertRow({ alert, signalTitle, isAdmin }: { alert: AlertRule; signalTitle: string; isAdmin: boolean }) {
  const { t, lang } = useI18n()
  const [isEditing, setIsEditing] = useState(false)
  const updateAlert = useUpdateAlert()
  const deleteAlert = useDeleteAlert()

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
          {alert.lastError && <div className="mt-0.5 text-xs text-level-error">{alert.lastError}</div>}
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
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
    </div>
  )
}

export function AlertsPage() {
  const { t } = useI18n()
  const { data: alerts, isLoading, error } = useAlerts()
  const { data: signals } = useSignals()
  const createAlert = useCreateAlert()
  const isAdmin = useIsAdmin()

  const signalTitle = (signalId: number) => signals?.find((signal) => signal.id === signalId)?.title ?? `#${signalId}`

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <h1 className="mb-4 text-lg font-semibold text-fg">{t.alerts.title}</h1>
      <p className="mb-4 text-xs text-fg-muted">{t.alerts.description}</p>

      {isAdmin && (
        <Card className="mb-6 p-4">
          <AlertForm submitLabel={t.common.create} onSubmit={(request) => createAlert.mutateAsync(request)} />
        </Card>
      )}

      {isLoading && <p className="text-sm text-fg-muted">{t.common.loading}</p>}
      {error && <p className="text-sm text-level-error">{error.message}</p>}
      {alerts && alerts.length === 0 && <p className="text-sm text-fg-muted">{t.alerts.noAlerts}</p>}

      {alerts && alerts.length > 0 && (
        <Card className="overflow-hidden">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} signalTitle={signalTitle(alert.signalId)} isAdmin={isAdmin} />
          ))}
        </Card>
      )}
    </div>
  )
}
