import { useState } from 'react'
import { useI18n } from '../../i18n'

/** Copies text to the clipboard and confirms in place for a moment. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  async function copy() {
    // jsdom and non-secure origins have no clipboard; the button simply does nothing there
    await navigator.clipboard?.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ?? t.detail.copy}
      title={label ?? t.detail.copy}
      className="rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      {copied ? t.detail.copied : '⧉'}
    </button>
  )
}
