import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createApiKey, getApiKeys } from '../api/settings'
import type { CreatedApiKey } from '../types'
import { useIsAdmin } from '../hooks/useAuth'
import { KEY_PLACEHOLDER, SEND_OPTIONS } from '../lib/sendSnippets'
import type { SendOption } from '../lib/sendSnippets'
import { useI18n } from '../i18n'
import { SectionBlock } from '../components/ui/SectionBlock'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { CopyButton } from '../components/detail/CopyButton'

const API_KEYS_KEY = ['apikeys']

/**
 * How to get data in, as a choice rather than a manual.
 *
 * The long version lives in docs/ingestion-app.md and docs/ingestion-otlp.md; this page exists
 * so that nobody has to go and find it, and so the answer to "what actually arrives if I pick
 * this one" is on the same screen as the snippet that decides it.
 */
export function SendLogsPage() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const keys = useQuery({ queryKey: API_KEYS_KEY, queryFn: getApiKeys })
  const [title, setTitle] = useState('')
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [pickedTitle, setPickedTitle] = useState('')

  const create = useMutation({
    mutationFn: (keyTitle: string) => createApiKey(keyTitle),
    onSuccess: (key) => {
      setCreatedKey(key)
      setPickedTitle(key.title)
      void keys.refetch()
    },
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    const fallback = `key-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    create.mutate(title.trim() || fallback)
  }

  // A key minted in this session is the only one whose token can ever appear here: the rest are
  // stored as hashes, so picking one names it in a comment and leaves the placeholder standing.
  const token = createdKey?.token
  const origin = window.location.origin

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg">{t.send.title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-fg-muted">{t.send.lead}</p>
        </div>
        <Link
          to="/events"
          className="shrink-0 rounded-lg border border-border bg-surface-inset px-3 py-1.5 text-sm font-medium text-fg-muted transition-all duration-200 hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
        >
          {t.send.seeEvents} →
        </Link>
      </div>

      <SectionBlock icon="settings" title={t.send.keyTitle} index={0}>
        <Panel className="p-4">
          <p className="mb-3 max-w-3xl text-sm leading-relaxed text-fg-muted">{t.send.keyHint}</p>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase">
                {t.send.keyPick}
              </span>
              <Select
                value={pickedTitle}
                onChange={(event) => setPickedTitle(event.target.value)}
                disabled={(keys.data ?? []).length === 0}
                className="min-w-56"
              >
                <option value="">
                  {(keys.data ?? []).length === 0 ? t.send.keyNoneYet : t.send.keyNone}
                </option>
                {(keys.data ?? []).map((key) => (
                  <option key={key.id} value={key.title}>
                    {key.title}
                  </option>
                ))}
              </Select>
            </label>

            {isAdmin ? (
              <form onSubmit={handleCreate} className="flex items-end gap-2">
                <Input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t.settings.keyTitlePlaceholder}
                  mono
                  className="w-56"
                />
                <Button type="submit" variant="primary" disabled={create.isPending}>
                  {t.settings.createKey}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-fg-muted">{t.send.keyAskAdmin}</p>
            )}
          </div>

          {create.error && <p className="mt-3 text-xs text-level-error">{create.error.message}</p>}

          {createdKey && (
            // warning tone on purpose: walking away without copying loses the token for good
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-level-warning/25 bg-level-warning/10 p-3">
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs text-fg">{t.send.keyCreated}</p>
                <code className="block break-all font-mono text-xs text-fg">{createdKey.token}</code>
              </div>
              <CopyButton value={createdKey.token} />
            </div>
          )}
        </Panel>
      </SectionBlock>

      <div className="grid gap-4 xl:grid-cols-2">
        {SEND_OPTIONS.filter((option) => option.id !== 'http').map((option, index) => (
          <OptionCard
            key={option.id}
            option={option}
            origin={origin}
            token={token}
            pickedTitle={pickedTitle}
            index={index + 1}
          />
        ))}
      </div>

      <OptionCard
        option={SEND_OPTIONS.find((option) => option.id === 'http')!}
        origin={origin}
        token={token}
        pickedTitle={pickedTitle}
        index={3}
      />

      <p className="px-1 text-xs leading-relaxed text-fg-subtle">
        {t.send.verified} {t.send.longVersion}{' '}
        <span className="font-mono text-fg-muted">docs/ingestion-app.md</span>,{' '}
        <span className="font-mono text-fg-muted">docs/ingestion-otlp.md</span>
      </p>
    </div>
  )
}

function OptionCard({
  option,
  origin,
  token,
  pickedTitle,
  index,
}: {
  option: SendOption
  origin: string
  token: string | undefined
  /** Named in a comment above the snippet, so the reader knows which key it is for. */
  pickedTitle: string
  index: number
}) {
  const { t } = useI18n()
  const pickIf = { otel: t.send.otelPickIf, serilog: t.send.serilogPickIf, http: t.send.httpPickIf }[option.id]
  const body = option.snippet(origin, token ?? KEY_PLACEHOLDER)
  const snippet = pickedTitle && !token ? `# ${pickedTitle}\n${body}` : body

  return (
    <SectionBlock title={option.name} index={index} className="flex flex-col">
      <div className="flex flex-1 flex-col gap-3 px-2 pb-1">
        <p className="text-sm leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">{t.send.pickIf} </span>
          {pickIf}
        </p>

        <div className="relative">
          <pre className="rounded-well overflow-x-auto bg-surface-inset p-3 pr-12 font-mono text-xs leading-relaxed text-fg">
            {snippet}
          </pre>
          <span className="absolute top-1.5 right-1.5">
            <CopyButton value={snippet} />
          </span>
        </div>

        <div>
          <h3 className="mb-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-fg-muted uppercase">
            {t.send.arrives}
          </h3>
          <Panel className="px-3 py-1">
            <dl className="divide-y divide-white/[0.04]">
              {option.arrives.map((fact) => (
                <div key={fact.field} className="flex items-baseline gap-3 py-1.5">
                  <dt className="w-32 shrink-0 font-mono text-xs text-fg-subtle">{t.send.fields[fact.field]}</dt>
                  <dd className="min-w-0 flex-1 text-xs leading-relaxed text-fg">
                    {t.send.notes[fact.note as keyof typeof t.send.notes]}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </SectionBlock>
  )
}
