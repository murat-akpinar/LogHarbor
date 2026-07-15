import { useState } from 'react'
import type { Signal } from '../types'
import { useCreateSignal, useDeleteSignal, useSignals, useUpdateSignal } from '../hooks/useSignals'
import { useIsAdmin } from '../hooks/useAuth'
import { SignalForm } from '../components/SignalForm'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'

function SignalRow({ signal, isAdmin }: { signal: Signal; isAdmin: boolean }) {
  const [isEditing, setIsEditing] = useState(false)
  const updateSignal = useUpdateSignal()
  const deleteSignal = useDeleteSignal()

  if (isEditing) {
    return (
      <div className="border-b border-border p-3 last:border-b-0">
        <SignalForm
          initialTitle={signal.title}
          initialFilter={signal.filter}
          submitLabel="Save"
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
              Edit
            </Button>
            <Button variant="danger" onClick={() => deleteSignal.mutate(signal.id)} disabled={deleteSignal.isPending}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {deleteSignal.error && <p className="mt-1 text-xs text-level-error">{deleteSignal.error.message}</p>}
    </div>
  )
}

export function SignalsPage() {
  const { data: signals, isLoading, error } = useSignals()
  const createSignal = useCreateSignal()
  const isAdmin = useIsAdmin()

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <h1 className="mb-4 text-lg font-semibold text-fg">Signals</h1>

      {isAdmin && (
        <Card className="mb-6 p-4">
          <SignalForm submitLabel="Create" onSubmit={(request) => createSignal.mutateAsync(request)} />
        </Card>
      )}

      {isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {error && <p className="text-sm text-level-error">{error.message}</p>}
      {signals && signals.length === 0 && <p className="text-sm text-fg-muted">No signals yet.</p>}

      {signals && signals.length > 0 && (
        <Card className="overflow-hidden">
          {signals.map((signal) => (
            <SignalRow key={signal.id} signal={signal} isAdmin={isAdmin} />
          ))}
        </Card>
      )}
    </div>
  )
}
