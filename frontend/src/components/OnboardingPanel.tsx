import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createApiKey } from '../api/settings'
import type { CreatedApiKey } from '../types'
import { useIsAdmin } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const TABS = ['curl', 'Serilog', 'OpenTelemetry'] as const
type Tab = (typeof TABS)[number]

// snippet bodies mirror docs/ingestion-app.md and docs/ingestion-otlp.md; code is never translated
function buildSnippet(tab: Tab, origin: string, key: string): string {
  switch (tab) {
    case 'curl':
      return [
        `curl -X POST "${origin}/api/events/raw" \\`,
        `  -H "X-LogHarbor-ApiKey: ${key}" \\`,
        '  -H "Content-Type: application/vnd.serilog.clef" \\',
        `  --data-binary '{"@t":"${new Date().toISOString()}","@mt":"Hello from {Source}","Source":"curl"}'`,
      ].join('\n')
    case 'Serilog':
      return [
        '// dotnet add package Serilog.Sinks.Seq',
        'Log.Logger = new LoggerConfiguration()',
        `    .WriteTo.Seq("${origin}", apiKey: "${key}")`,
        '    .CreateLogger();',
        '',
        'Log.Information("Hello from {Source}", "Serilog");',
      ].join('\n')
    case 'OpenTelemetry':
      return [
        `OTEL_EXPORTER_OTLP_ENDPOINT=${origin}`,
        'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
        `OTEL_EXPORTER_OTLP_HEADERS=X-LogHarbor-ApiKey=${key}`,
      ].join('\n')
  }
}

/** First-run state of the Events page: the server has no events at all, so instead of an
 * empty table, walk the user to their first one (spec: 2026-07-17-first-run-onboarding). */
export function OnboardingPanel() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const [title, setTitle] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('curl')
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: (keyTitle: string) => createApiKey(keyTitle),
    onSuccess: setCreatedKey,
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    // the title is only a label for telling keys apart later, so an empty one still creates a key
    const fallback = `key-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    create.mutate(title.trim() || fallback)
  }

  const snippet = buildSnippet(activeTab, window.location.origin, createdKey?.token ?? '<API_KEY>')

  function copySnippet() {
    void navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl rounded-card border border-border bg-surface-raised p-6 shadow-card">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t.onboarding.title}</h2>
        <p className="mb-4 text-sm text-fg-muted">{t.onboarding.intro}</p>

        {isAdmin ? (
          createdKey ? (
            // warning tone on purpose: walking away without copying loses the token for good
            <div className="mb-4 rounded-lg border border-level-warning/25 bg-level-warning/10 p-3">
              <p className="mb-1 text-xs text-fg">{t.settings.copyTokenNotice}</p>
              <code className="block break-all font-mono text-xs text-fg">{createdKey.token}</code>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="mb-4 flex gap-2">
              <Input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t.settings.keyTitlePlaceholder}
                mono
                className="flex-1"
              />
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {t.settings.createKey}
              </Button>
            </form>
          )
        ) : (
          <p className="mb-4 text-sm text-fg-muted">{t.onboarding.askAdmin}</p>
        )}
        {create.error && <p className="mb-4 text-xs text-level-error">{create.error.message}</p>}

        <div className="mb-2 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors duration-150 ${
                tab === activeTab
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre
            data-testid="onboarding-snippet"
            className="overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-5 text-fg"
          >
            {snippet}
          </pre>
          <Button variant="ghost" onClick={copySnippet} className="absolute right-1 top-1">
            {copied ? t.onboarding.copied : t.onboarding.copy}
          </Button>
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          {t.onboarding.waiting}
        </p>
      </div>
    </div>
  )
}
