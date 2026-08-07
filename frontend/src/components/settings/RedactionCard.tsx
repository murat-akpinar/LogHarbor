import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRedactionSettings, saveRedactionSettings } from '../../api/settings'
import { useIsAdmin } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState, ErrorState, Skeleton } from '../ui/States'
import { useI18n } from '../../i18n'

const REDACTION_KEY = ['redaction-settings']

/** The names worth offering: what a middleware, an auth library or a form actually calls the
 *  fields nobody wants stored. One click each, and nothing is saved until Save. */
const SUGGESTIONS = [
  'password',
  'authorization',
  'cookie',
  'token',
  'secret',
  'api_key',
  'apikey',
  'credential',
]

/**
 * The deny-list, as a list you can read.
 *
 * Deliberately not a free-text blob: every entry here permanently destroys data on the way in,
 * so each one has to be visible as its own object, added on purpose and removable on sight.
 */
export function RedactionCard() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: REDACTION_KEY, queryFn: getRedactionSettings })
  // the saved list is the source of truth until the reader edits: `null` means "not editing"
  const [draft, setDraft] = useState<string[] | null>(null)
  const [entry, setEntry] = useState('')

  const names = draft ?? settings.data?.properties ?? []
  const dirty = draft !== null

  const save = useMutation({
    mutationFn: () => saveRedactionSettings(names),
    onSuccess: (saved) => {
      queryClient.setQueryData(REDACTION_KEY, saved)
      setDraft(null)
    },
  })

  function add(name: string) {
    const next = name.trim().toLowerCase()
    if (next.length === 0 || names.includes(next)) return
    setDraft([...names, next])
    setEntry('')
  }

  function remove(name: string) {
    setDraft(names.filter((existing) => existing !== name))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    add(entry)
  }

  if (settings.isPending) {
    return <Skeleton className="h-20 w-full" />
  }
  if (settings.error) {
    return <ErrorState message={settings.error.message} onRetry={() => settings.refetch()} />
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-sm leading-relaxed text-fg-muted">{t.settings.redactionHint}</p>

      {names.length === 0 ? (
        <EmptyState title={t.settings.redactionNone} description={t.settings.redactionNoneHint} />
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <li key={name}>
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface-inset px-2.5 py-1 font-mono text-xs text-fg">
                {name}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => remove(name)}
                    aria-label={t.settings.redactionRemove(name)}
                    className="text-fg-subtle transition-colors hover:text-level-error"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <>
          <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <Input
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              aria-label={t.settings.redactionAddLabel}
              placeholder={t.settings.redactionPlaceholder}
              className="w-56 font-mono text-sm"
            />
            <Button type="submit" variant="secondary">
              {t.common.add}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t.login.saving : t.common.save}
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-fg-subtle">{t.settings.redactionSuggestions}</span>
            {SUGGESTIONS.filter((name) => !names.includes(name)).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => add(name)}
                className="rounded-full border border-dashed border-border px-2 py-0.5 font-mono text-xs text-fg-muted transition-colors hover:border-accent/50 hover:text-fg"
              >
                + {name}
              </button>
            ))}
          </div>
        </>
      )}

      {save.error && <ErrorState message={save.error.message} />}
      {/* what it does not reach, said once, where the list is: an operator who reads this card as
          "secrets cannot be here" would stop looking at the two places it cannot clean */}
      <p className="max-w-3xl text-xs leading-relaxed text-fg-subtle">{t.settings.redactionLimits}</p>
    </div>
  )
}
