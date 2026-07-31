import { useState } from 'react'
import type { Signal } from '../types'
import { useCreateSignal, useDeleteSignal, useSignals, useUpdateSignal } from '../hooks/useSignals'
import { useIsAdmin } from '../hooks/useAuth'
import { SignalForm } from '../components/SignalForm'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { useI18n } from '../i18n'

function SignalRow({ signal, isAdmin }: { signal: Signal; isAdmin: boolean }) {
  const { t } = useI18n()
  const [isEditing, setIsEditing] = useState(false)
  const updateSignal = useUpdateSignal()
  const deleteSignal = useDeleteSignal()

  if (isEditing) {
    return (
      <div className="border-b border-border p-3 last:border-b-0">
        <SignalForm
          initialTitle={signal.title}
          initialFilter={signal.filter}
          submitLabel={t.common.save}
          onCancel={() => setIsEditing(false)}
          onSubmit={async (request) => {
            await updateSignal.mutateAsync({ id: signal.id, request })
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
          <span className="font-medium text-fg">{signal.title}</span>
          <span className="ml-3 truncate font-mono text-xs text-fg-muted">{signal.filter}</span>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={() => setIsEditing(true)}>
              {t.common.edit}
            </Button>
            <Button variant="danger" onClick={() => deleteSignal.mutate(signal.id)} disabled={deleteSignal.isPending}>
              {t.common.delete}
            </Button>
          </div>
        )}
      </div>
      {deleteSignal.error && <p className="mt-1 text-xs text-level-error">{deleteSignal.error.message}</p>}
    </div>
  )
}

export function SignalsPage() {
  const { t } = useI18n()
  const { data: signals, isLoading, error } = useSignals()
  const createSignal = useCreateSignal()
  const isAdmin = useIsAdmin()

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold text-fg">{t.signals.title}</h1>

      {isAdmin && (
        <SectionBlock icon="signals" title={t.signals.newSignal} index={0}>
          <Panel className="p-4">
            <SignalForm submitLabel={t.common.create} onSubmit={(request) => createSignal.mutateAsync(request)} />
          </Panel>
        </SectionBlock>
      )}

      {/* headerless: the page's own h1 already names the one list on it */}
      <SectionBlock index={1}>
        <Panel className="overflow-hidden">
          {isLoading && <p className="p-4 text-sm text-fg-muted">{t.common.loading}</p>}
          {error && <p className="p-4 text-sm text-level-error">{error.message}</p>}
          {signals && signals.length === 0 && <p className="p-4 text-sm text-fg-muted">{t.signals.noSignals}</p>}
          {signals?.map((signal) => (
            <SignalRow key={signal.id} signal={signal} isAdmin={isAdmin} />
          ))}
        </Panel>
      </SectionBlock>
    </div>
  )
}
