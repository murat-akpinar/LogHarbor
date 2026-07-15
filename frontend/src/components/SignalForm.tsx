import { useState } from 'react'
import type { FormEvent } from 'react'
import { validateFilter } from '../api/events'
import type { SignalRequest } from '../api/signals'
import { useI18n } from '../i18n'
import { Input } from './ui/Input'
import { Button } from './ui/Button'

interface SignalFormProps {
  initialTitle?: string
  initialFilter?: string
  submitLabel: string
  onSubmit: (request: SignalRequest) => Promise<unknown>
  onCancel?: () => void
}

export function SignalForm({ initialTitle = '', initialFilter = '', submitLabel, onSubmit, onCancel }: SignalFormProps) {
  const { t } = useI18n()
  const [title, setTitle] = useState(initialTitle)
  const [filter, setFilter] = useState(initialFilter)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    const trimmedFilter = filter.trim()
    if (!trimmedTitle || !trimmedFilter) {
      setError(t.signals.bothRequired)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const validation = await validateFilter(trimmedFilter)
      if (!validation.valid) {
        setError(
          validation.position !== undefined
            ? t.filters.errorAtPosition(validation.error ?? t.filters.invalidFilter, validation.position)
            : (validation.error ?? t.filters.invalidFilter),
        )
        return
      }
      await onSubmit({ title: trimmedTitle, filter: trimmedFilter })
      if (!initialTitle) {
        setTitle('')
        setFilter('')
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t.signals.couldNotSave)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <Input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t.signals.titlePlaceholder}
        className="sm:w-48"
        disabled={isSubmitting}
      />
      <Input
        type="text"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="@Level = 'Error'"
        mono
        className="flex-1"
        disabled={isSubmitting}
      />
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
      {error && <p className="text-xs text-level-error sm:basis-full">{error}</p>}
    </form>
  )
}
