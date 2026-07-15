import { useState } from 'react'
import type { FormEvent } from 'react'
import { useSignals } from '../hooks/useSignals'
import type { AlertRequest } from '../api/alerts'
import { useI18n } from '../i18n'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Button } from './ui/Button'

interface AlertFormProps {
  initial?: AlertRequest
  submitLabel: string
  onSubmit: (request: AlertRequest) => Promise<unknown>
  onCancel?: () => void
}

const DEFAULTS: AlertRequest = {
  title: '',
  signalId: 0,
  thresholdCount: 1,
  windowMinutes: 5,
  webhookUrl: '',
  isEnabled: true,
}

export function AlertForm({ initial, submitLabel, onSubmit, onCancel }: AlertFormProps) {
  const { t } = useI18n()
  const { data: signals } = useSignals()
  const [form, setForm] = useState<AlertRequest>(initial ?? DEFAULTS)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.title.trim() || !form.signalId || !form.webhookUrl.trim()) {
      setError(t.alerts.allRequired)
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit({ ...form, title: form.title.trim(), webhookUrl: form.webhookUrl.trim() })
      if (!initial) setForm(DEFAULTS)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t.alerts.couldNotSave)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Input
          type="text"
          value={form.title}
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          placeholder={t.alerts.titlePlaceholder}
          className="sm:w-48"
          disabled={isSubmitting}
        />
        <Select
          value={form.signalId || ''}
          onChange={(event) => setForm((current) => ({ ...current, signalId: Number(event.target.value) }))}
          disabled={isSubmitting}
        >
          <option value="" disabled>
            {t.alerts.selectSignal}
          </option>
          {(signals ?? []).map((signal) => (
            <option key={signal.id} value={signal.id}>
              {signal.title}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min={1}
          value={form.thresholdCount}
          onChange={(event) => setForm((current) => ({ ...current, thresholdCount: Number(event.target.value) }))}
          placeholder={t.alerts.countPlaceholder}
          title={t.alerts.thresholdTitle}
          className="w-20"
          disabled={isSubmitting}
        />
        <Input
          type="number"
          min={1}
          value={form.windowMinutes}
          onChange={(event) => setForm((current) => ({ ...current, windowMinutes: Number(event.target.value) }))}
          placeholder={t.alerts.minutesPlaceholder}
          title={t.alerts.windowTitle}
          className="w-24"
          disabled={isSubmitting}
        />
        <Input
          type="text"
          value={form.webhookUrl}
          onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))}
          placeholder="https://example.com/webhook"
          className="min-w-64 flex-1"
          disabled={isSubmitting}
        />
        <label className="flex items-center gap-1.5 text-sm text-fg">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(event) => setForm((current) => ({ ...current, isEnabled: event.target.checked }))}
            disabled={isSubmitting}
          />
          {t.alerts.enabledLabel}
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-level-error">{error}</p>}
    </form>
  )
}
