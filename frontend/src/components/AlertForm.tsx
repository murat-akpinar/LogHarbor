import { useState } from 'react'
import type { FormEvent } from 'react'
import { useSignals } from '../hooks/useSignals'
import { validateFilter } from '../api/events'
import type { AlertRequest } from '../api/alerts'
import type { AlertPayloadFormat } from '../types'
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

// a rule's own filter, not a signal: the common case is a condition nobody wants cluttering the
// signal list, and a fresh install has no signals to pick from at all
const DEFAULTS: AlertRequest = {
  title: '',
  signalId: null,
  filter: '',
  thresholdCount: 1,
  windowMinutes: 5,
  webhookUrl: '',
  isEnabled: true,
  payloadFormat: 'generic',
  condition: 'at-least',
}

/** The one select covers both sources, so its value has to say which: a signal id or the rule's own filter. */
const OWN_FILTER = 'filter'

const watchedValue = (form: AlertRequest) => (form.signalId === null ? OWN_FILTER : `signal:${form.signalId}`)

export function AlertForm({ initial, submitLabel, onSubmit, onCancel }: AlertFormProps) {
  const { t } = useI18n()
  const { data: signals } = useSignals()
  const [form, setForm] = useState<AlertRequest>(initial ?? DEFAULTS)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const watchesOwnFilter = form.signalId === null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const filter = (form.filter ?? '').trim()
    if (!form.title.trim() || !form.webhookUrl.trim() || (watchesOwnFilter && !filter)) {
      setError(t.alerts.allRequired)
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      // same check the Signals form makes, for the same reason: a filter that does not parse is
      // caught while the box is still open, not by a rule that quietly never fires
      if (watchesOwnFilter) {
        const validation = await validateFilter(filter)
        if (!validation.valid) {
          setError(
            validation.position !== undefined
              ? t.filters.errorAtPosition(validation.error ?? t.filters.invalidFilter, validation.position)
              : (validation.error ?? t.filters.invalidFilter),
          )
          return
        }
      }
      await onSubmit({
        ...form,
        title: form.title.trim(),
        webhookUrl: form.webhookUrl.trim(),
        filter: watchesOwnFilter ? filter : null,
      })
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
          value={form.condition}
          onChange={(event) => {
            const condition = event.target.value as AlertRequest['condition']
            setForm((current) => ({
              ...current,
              condition,
              thresholdCount: condition === 'silence' ? 0 : current.thresholdCount || 1,
            }))
          }}
          title={t.alerts.conditionTitle}
          disabled={isSubmitting}
        >
          <option value="at-least">{t.alerts.conditionAtLeast}</option>
          <option value="silence">{t.alerts.conditionSilence}</option>
        </Select>
        <Select
          value={watchedValue(form)}
          onChange={(event) => {
            const watched = event.target.value
            setForm((current) => ({
              ...current,
              signalId: watched === OWN_FILTER ? null : Number(watched.slice('signal:'.length)),
            }))
          }}
          title={t.alerts.watchTitle}
          disabled={isSubmitting}
        >
          <option value={OWN_FILTER}>{t.alerts.watchOwnFilter}</option>
          {(signals ?? []).length > 0 && (
            <optgroup label={t.alerts.watchSignalGroup}>
              {(signals ?? []).map((signal) => (
                <option key={signal.id} value={`signal:${signal.id}`}>
                  {signal.title}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        {watchesOwnFilter && (
          <Input
            type="text"
            value={form.filter ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, filter: event.target.value }))}
            placeholder="@Level = 'Error'"
            title={t.alerts.filterTitle}
            mono
            className="min-w-56 flex-1"
            disabled={isSubmitting}
          />
        )}
        {form.condition === 'at-least' && (
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
        )}
        <Input
          type="number"
          min={1}
          value={form.windowMinutes}
          onChange={(event) => setForm((current) => ({ ...current, windowMinutes: Number(event.target.value) }))}
          placeholder={t.alerts.minutesPlaceholder}
          title={form.condition === 'silence' ? t.alerts.silenceWindowTitle : t.alerts.windowTitle}
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
        <Select
          value={form.payloadFormat}
          onChange={(event) =>
            setForm((current) => ({ ...current, payloadFormat: event.target.value as AlertPayloadFormat }))
          }
          title={t.alerts.formatTitle}
          disabled={isSubmitting}
        >
          <option value="generic">{t.alerts.formatGeneric}</option>
          <option value="slack">Slack</option>
          <option value="discord">Discord</option>
        </Select>
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
