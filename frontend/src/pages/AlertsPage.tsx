import { useState } from 'react'
import type { AlertRule } from '../types'
import { useAlerts, useCreateAlert, useDeleteAlert, useUpdateAlert } from '../hooks/useAlerts'
import { useSignals } from '../hooks/useSignals'
import { useIsAdmin } from '../hooks/useAuth'
import { formatTimestamp } from '../lib/dates'
import { AlertForm } from '../components/AlertForm'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
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
          {isLoading && <p className="p-4 text-sm text-fg-muted">{t.common.loading}</p>}
          {error && <p className="p-4 text-sm text-level-error">{error.message}</p>}
          {alerts && alerts.length === 0 && <p className="p-4 text-sm text-fg-muted">{t.alerts.noAlerts}</p>}
          {alerts?.map((alert) => (
            <AlertRow key={alert.id} alert={alert} signalTitle={signalTitle(alert.signalId)} isAdmin={isAdmin} />
          ))}
        </Panel>
      </SectionBlock>
    </div>
  )
}
