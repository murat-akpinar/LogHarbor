export interface SettingsTab {
  id: string
  label: string
}

/**
 * One screen of settings at a time.
 *
 * Six cards in one scroll made every visit a hunt: the page answered six questions at once and
 * none of them first. Tabs are in the URL, so a link to the storage settings stays a link to the
 * storage settings.
 */
export function SettingsTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: SettingsTab[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-inset p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          aria-controls={`settings-panel-${tab.id}`}
          id={`settings-tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
            tab.id === active
              ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
