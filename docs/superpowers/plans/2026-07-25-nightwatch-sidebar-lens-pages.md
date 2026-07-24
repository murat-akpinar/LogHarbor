# Nightwatch Sidebar & Activity Lens Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal top nav with a Nightwatch-style grouped left sidebar and add two activity lens pages: `/requests` (Operations RED table promoted out of Analysis) and `/exceptions` (live exception feed with an inline trace-context panel).

**Architecture:** Frontend-only. Every page composes existing `/api/stats/*`, events search, and trace reads — zero backend changes. The sidebar replaces `NavBar`; `RequestsPage` is extracted from `AnalysisPage`'s Operations section; `ExceptionsPage` reuses the dashboard's live-poll pattern and the `Sparkline`/`LiveToggle` components.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind, React Query, react-router, Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-07-25-nightwatch-sidebar-lens-pages-design.md`.

## Global Constraints

- Work on the **`development`** branch only; never commit to `main` (user merges on approval).
- All code, comments, commit messages in English (`rules.md`).
- TypeScript strict, no `any`; API calls only through `src/api/`; Tailwind only, no inline style objects, no new CSS files; React Query for server state, `useState` for UI state (`rules.md`).
- i18n: `frontend/src/i18n/en.ts` is the source of truth; `tr.ts` is typed `Messages = typeof en`, so every new key MUST be added to both files or the build breaks.
- Visual language (spec §Visual language): existing Tailwind tokens only (`bg-surface`, `border-border`, `text-fg`, `text-fg-muted`, `accent`, `LEVEL_HEX`), both themes must work; uppercase muted group headers; no icon library; no chart library.
- Frontend tests: user-facing behavior only, mirror the existing page-test pattern (jsdom, `vi.mock('../api/stats')`, `QueryClientProvider` + `LanguageProvider` + `MemoryRouter`, `localStorage.setItem('logharbor-lang', 'en')`).
- Commands (run in `frontend/`): all tests `npm run test`; one file `npm run test -- src/pages/RequestsPage.test.tsx`; build `npm run build`. Backend suite (repo root): `dotnet test backend`.
- Commit messages: imperative, ≤72-char first line, end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Sidebar replaces NavBar

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/Sidebar.test.tsx`
- Modify: `frontend/src/App.tsx` (import + layout)
- Modify: `frontend/src/i18n/en.ts` (nav keys), `frontend/src/i18n/tr.ts` (same keys)
- Delete: `frontend/src/components/NavBar.tsx`, `frontend/src/components/NavBar.test.tsx`

**Interfaces:**
- Consumes: `useI18n()` from `../i18n`, `Theme` type from `../hooks/useTheme`, `Button` from `./ui/Button`.
- Produces: `export function Sidebar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void })` — same props NavBar had. Tasks 2 and 3 each add one item to its `groups` array.

Note: this task's sidebar lists only existing pages. `/requests` and `/exceptions` enter the sidebar in Tasks 2/3 together with their routes, so the app never links to a 404.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Sidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../i18n'
import { Sidebar } from './Sidebar'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderSidebar() {
  localStorage.setItem('logharbor-lang', 'en')
  render(
    <LanguageProvider>
      <MemoryRouter>
        <Sidebar theme="light" onToggleTheme={() => {}} />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

it('renders grouped navigation with an Overview link', () => {
  renderSidebar()
  expect(screen.getByText('Activity')).toBeDefined()
  expect(screen.getByText('System')).toBeDefined()
  expect(screen.getByText('Overview')).toBeDefined()
  expect(screen.getByText('Events')).toBeDefined()
})

it('opens the mobile drawer from the hamburger button', () => {
  renderSidebar()
  // desktop aside renders one copy; the drawer adds a second
  expect(screen.getAllByText('Events')).toHaveLength(1)
  screen.getByLabelText('Open menu').click()
  expect(screen.getAllByText('Events')).toHaveLength(2)
})

it('switches visible link labels when the language toggle is clicked', async () => {
  renderSidebar()
  expect(screen.getByText('Events')).toBeDefined()
  screen.getByText('EN').click()
  expect(await screen.findByText('Olaylar')).toBeDefined()
  expect(screen.queryByText('Events')).toBeNull()
  expect(localStorage.getItem('logharbor-lang')).toBe('tr')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (in `frontend/`): `npm run test -- src/components/Sidebar.test.tsx`
Expected: FAIL — `Sidebar` module not found.

- [ ] **Step 3: Add the i18n keys**

In `frontend/src/i18n/en.ts`, extend the `nav` object (keep existing keys):

```ts
  nav: {
    // ...existing keys stay...
    overview: 'Overview',
    groupActivity: 'Activity',
    groupAnalysis: 'Analysis',
    groupSystem: 'System',
    openMenu: 'Open menu',
  },
```

In `frontend/src/i18n/tr.ts`, mirror them (wording matches existing tr vocabulary — `dashboard.activity` is already 'Etkinlik'):

```ts
  nav: {
    // ...existing keys stay...
    overview: 'Genel Bakış',
    groupActivity: 'Etkinlik',
    groupAnalysis: 'Analiz',
    groupSystem: 'Sistem',
    openMenu: 'Menüyü aç',
  },
```

- [ ] **Step 4: Implement Sidebar**

Create `frontend/src/components/Sidebar.tsx`:

```tsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'

interface SidebarProps {
  theme: Theme
  onToggleTheme: () => void
}

interface NavItem {
  to: string
  label: string
  end?: boolean
}

interface NavGroup {
  /** null renders the items without a group caption (the Overview row). */
  header: string | null
  items: NavItem[]
}

const LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2 py-1.5 text-sm font-medium transition-colors duration-150 ${
    isActive ? 'bg-surface-raised text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
  }`

/** Nightwatch-style grouped left nav; on small screens a top bar with a hamburger drawer. */
export function Sidebar({ theme, onToggleTheme }: SidebarProps) {
  const { t, lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)

  const groups: NavGroup[] = [
    { header: null, items: [{ to: '/', label: t.nav.overview, end: true }] },
    { header: t.nav.groupActivity, items: [{ to: '/events', label: t.nav.events }] },
    {
      header: t.nav.groupAnalysis,
      items: [
        { to: '/analysis', label: t.nav.analysis },
        { to: '/services', label: t.nav.services },
        { to: '/users', label: t.nav.users },
      ],
    },
    {
      header: t.nav.groupSystem,
      items: [
        { to: '/signals', label: t.nav.signals },
        { to: '/alerts', label: t.nav.alerts },
        { to: '/settings', label: t.nav.settings },
      ],
    },
  ]

  const content = (
    <>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-semibold text-fg">
        <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
        LogHarbor
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2">
        {groups.map((group) => (
          <div key={group.header ?? 'top'} className="flex flex-col gap-0.5">
            {group.header && (
              <p className="mt-4 mb-1 px-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                {group.header}
              </p>
            )}
            {group.items.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={LINK_CLASS}>
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1 border-t border-border p-2">
        <Button
          variant="ghost"
          onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
          aria-label={t.nav.switchLanguage}
          title={t.nav.switchLanguage}
        >
          {lang.toUpperCase()}
        </Button>
        <Button
          variant="ghost"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
          title={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </Button>
      </div>
    </>
  )

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
        <Button variant="ghost" onClick={() => setOpen(true)} aria-label={t.nav.openMenu} title={t.nav.openMenu}>
          ☰
        </Button>
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          LogHarbor
        </span>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-56 flex-col border-r border-border bg-surface">
            {content}
          </aside>
        </div>
      )}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">{content}</aside>
    </>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/components/Sidebar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Swap it into the app shell**

In `frontend/src/App.tsx`:
- Replace `import { NavBar } from './components/NavBar'` with `import { Sidebar } from './components/Sidebar'`.
- Change the shell so the sidebar sits left on desktop (mobile keeps the stacked top bar):

```tsx
            <div className="flex h-screen flex-col bg-bg text-fg md:flex-row">
              <Sidebar theme={theme} onToggleTheme={toggleTheme} />
              <main className="min-h-0 min-w-0 flex-1">
```

(The `Routes` block inside `<main>` is unchanged.)

- [ ] **Step 7: Delete NavBar**

Delete `frontend/src/components/NavBar.tsx` and `frontend/src/components/NavBar.test.tsx` (its language-toggle test now lives in `Sidebar.test.tsx`).

- [ ] **Step 8: Run the full frontend suite and the build**

Run: `npm run test` then `npm run build`
Expected: all tests pass; build succeeds (proves no lingering NavBar imports).

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src
git commit -m "feat(nav): grouped Nightwatch-style sidebar replaces the top nav"
```

---

### Task 2: /requests lens page

**Files:**
- Create: `frontend/src/pages/RequestsPage.tsx`
- Create: `frontend/src/pages/RequestsPage.test.tsx`
- Modify: `frontend/src/App.tsx` (route), `frontend/src/components/Sidebar.tsx` (nav item)
- Modify: `frontend/src/i18n/en.ts` + `tr.ts` (`nav.requests`, `requests` section)
- Modify: `frontend/src/pages/AnalysisPage.tsx` (drop the Operations section)
- Modify: `frontend/src/pages/AnalysisPage.test.tsx` (drop the operations test + mock)
- Modify: `frontend/src/components/dashboard/RoutesPanel.tsx` (`to="/requests"`)
- Modify: `frontend/src/pages/DashboardPage.test.tsx` (assert the new href)

**Interfaces:**
- Consumes: `useOperations({ from, to, limit })` from `../hooks/useStats` (returns `{ operations: OperationOverview[] }`; `OperationOverview` has `template: string`, `total: number`, `errorCount: number`, `p95ElapsedMs: number | null`); `Sparkline`, `TimeRangePicker`, `Card`, `quote`, `LEVEL_HEX`.
- Produces: `export function RequestsPage()` routed at `/requests`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/RequestsPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { RequestsPage } from './RequestsPage'

vi.mock('../api/stats', () => ({
  getOperations: vi.fn(async () => ({
    operations: [
      { template: 'GET /api/orders/{id}', total: 90, errorCount: 0, p95ElapsedMs: 120 },
      { template: 'POST /api/orders', total: 10, errorCount: 5, p95ElapsedMs: 300 },
    ],
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <RequestsPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

function bodyRowTexts(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1) // skip the header row
    .map((row) => row.textContent ?? '')
}

it('lists operations with their RED numbers, busiest first', async () => {
  renderPage()
  expect(await screen.findByText('GET /api/orders/{id}')).toBeDefined()
  // error % = 5 / 10 = 50.0%
  expect(screen.getByText('50.0%')).toBeDefined()
  expect(bodyRowTexts()[0]).toContain('GET /api/orders/{id}')
})

it('re-sorts by error % when that header is clicked', async () => {
  renderPage()
  await screen.findByText('GET /api/orders/{id}')
  screen.getByRole('button', { name: 'Error %' }).click()
  await waitFor(() => {
    expect(bodyRowTexts()[0]).toContain('POST /api/orders')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/pages/RequestsPage.test.tsx`
Expected: FAIL — `RequestsPage` module not found.

- [ ] **Step 3: Add the i18n keys**

`frontend/src/i18n/en.ts` — add to `nav`: `requests: 'Requests',` and add a new top-level section after `analysis`:

```ts
  requests: {
    title: 'Requests',
  },
```

`frontend/src/i18n/tr.ts` — add to `nav`: `requests: 'İstekler',` and:

```ts
  requests: {
    title: 'İstekler',
  },
```

- [ ] **Step 4: Implement RequestsPage**

Create `frontend/src/pages/RequestsPage.tsx` (the table body is the one extracted from `AnalysisPage`'s Operations section, plus sortable headers):

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OperationOverview } from '../types'
import { useOperations } from '../hooks/useStats'
import { Sparkline } from '../components/Sparkline'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const DEFAULT_RANGE_HOURS = 24
const ROW_LIMIT = 50

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

type SortKey = 'total' | 'errorPct' | 'p95'

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** ms with locale thousands grouping: 2559 -> "2.559 ms" (tr) / "2,559 ms" (en). */
function formatMs(ms: number, locale: string): string {
  return `${Math.round(ms).toLocaleString(locale)} ms`
}

function errorFraction(op: OperationOverview): number {
  return op.total > 0 ? op.errorCount / op.total : 0
}

export function RequestsPage() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [range, setRange] = useState(defaultRange)
  const [sortKey, setSortKey] = useState<SortKey>('total')

  const operations = useOperations({ ...range, limit: ROW_LIMIT })
  const rangeMinutes = Math.max(1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / 60_000)

  const rows = [...(operations.data?.operations ?? [])].sort((a, b) => {
    if (sortKey === 'errorPct') return errorFraction(b) - errorFraction(a)
    // operations without a duration sort last
    if (sortKey === 'p95') return (b.p95ElapsedMs ?? -1) - (a.p95ElapsedMs ?? -1)
    return b.total - a.total
  })

  function openEvents(template: string) {
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      filter: `@MessageTemplate = ${quote(template)}`,
    })
    navigate(`/events?${params.toString()}`)
  }

  function sortableHeader(key: SortKey, label: string) {
    return (
      <th className={`${TH_CLASS} text-right`} aria-sort={sortKey === key ? 'descending' : undefined}>
        <button
          type="button"
          onClick={() => setSortKey(key)}
          className={`transition-colors hover:text-fg ${sortKey === key ? 'text-fg' : ''}`}
        >
          {label}
          {sortKey === key ? ' ↓' : ''}
        </button>
      </th>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{t.requests.title}</h1>
        <TimeRangePicker
          from={range.from}
          to={range.to}
          onChange={(next) => {
            if (next.from) setRange({ from: next.from, to: next.to ?? new Date().toISOString() })
          }}
        />
      </div>

      {operations.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{operations.error.message}</p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.analysis.operation}</th>
              {sortableHeader('total', t.analysis.eventsPerMin)}
              {sortableHeader('errorPct', t.analysis.errorPct)}
              {sortableHeader('p95', t.analysis.p95)}
              <th className={TH_CLASS}>{t.analysis.trend}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((op) => {
              const errorPct = errorFraction(op) * 100
              return (
                <tr
                  key={op.template}
                  onClick={() => openEvents(op.template)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{op.template}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {(op.total / rangeMinutes).toLocaleString(lang, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  <td className={`${TD_CLASS} tabular text-right ${errorPct > 0 ? 'text-level-error' : ''}`}>
                    {errorPct.toFixed(1)}%
                  </td>
                  <td className={`${TD_CLASS} tabular text-right`}>
                    {op.p95ElapsedMs === null ? '—' : formatMs(op.p95ElapsedMs, lang)}
                  </td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={`@MessageTemplate = ${quote(op.template)}`}
                      color={errorPct > 0 ? LEVEL_HEX.Error : LEVEL_HEX.Information}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {operations.data?.operations.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">{t.analysis.noOperations}</p>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Wire the route and the sidebar item**

- `frontend/src/App.tsx`: add `import { RequestsPage } from './pages/RequestsPage'` and, right after the `/events` route, `<Route path="/requests" element={<RequestsPage />} />`.
- `frontend/src/components/Sidebar.tsx`: in the `groupActivity` group, after the Events item, add `{ to: '/requests', label: t.nav.requests },`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- src/pages/RequestsPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Drop the Operations section from Analysis**

In `frontend/src/pages/AnalysisPage.tsx`:
- Remove `useOperations` from the `../hooks/useStats` import and delete the `const operations = useOperations(...)` line.
- Delete the now-unused `rangeMinutes` line (only the Operations table used it).
- Change `const queryError = operations.error ?? errors.error ?? ...` to `const queryError = errors.error ?? exceptions.error ?? slow.error`.
- Delete the whole `<section>` containing `{t.analysis.operationsTitle}` (the first section, with the operations table).

In `frontend/src/pages/AnalysisPage.test.tsx`:
- Delete the `it('lists operations with their RED numbers', ...)` test (RequestsPage now owns that behavior).
- Remove the `getOperations` entry from the `vi.mock('../api/stats', ...)` factory.

- [ ] **Step 8: Point the dashboard Routes card at /requests**

- `frontend/src/components/dashboard/RoutesPanel.tsx`: change `to="/analysis"` to `to="/requests"` in the `PulsePanel` props.
- `frontend/src/pages/DashboardPage.test.tsx`: in the `it('groups content under sections and links Activity to Events', ...)` test, add `expect(hrefs).toContain('/requests')` next to the existing `/analysis` assertion (the Analysis section header still links to `/analysis`, so that line stays).

- [ ] **Step 9: Run the full frontend suite**

Run: `npm run test`
Expected: PASS, including the updated Analysis and Dashboard tests.

- [ ] **Step 10: Commit**

```bash
git add -A frontend/src
git commit -m "feat(requests): /requests lens page owns the operations RED table"
```

---

### Task 3: /exceptions live feed page

**Files:**
- Create: `frontend/src/pages/ExceptionsPage.tsx`
- Create: `frontend/src/pages/ExceptionsPage.test.tsx`
- Modify: `frontend/src/lib/filter.ts` (add `exceptionStartsWith`)
- Modify: `frontend/src/App.tsx` (route), `frontend/src/components/Sidebar.tsx` (nav item)
- Modify: `frontend/src/i18n/en.ts` + `tr.ts` (`nav.exceptions`, `exceptions` section)

**Interfaces:**
- Consumes: `useTopExceptions({ from, to, limit })` (returns `{ exceptions: TopException[] }`; `TopException` has `type: string`, `count: number`, `firstSeen: string`, `lastSeen: string`); `LiveToggle` (`live: boolean; onToggle: () => void`, renders the text `t.dashboard.live`); `Sparkline`, `TimeRangePicker`, `Card`, `formatTimestamp` from `../lib/dates`.
- Produces: `export function ExceptionsPage()` routed at `/exceptions`; `export function exceptionStartsWith(type: string): string` in `frontend/src/lib/filter.ts` (Task 4 reuses it).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/ExceptionsPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../i18n'
import { ExceptionsPage } from './ExceptionsPage'

vi.mock('../api/stats', () => ({
  getTopExceptions: vi.fn(async () => ({
    exceptions: [
      {
        type: 'System.NullReferenceException',
        count: 88,
        firstSeen: '2026-07-25T08:00:00.000Z',
        lastSeen: '2026-07-25T09:30:00.000Z',
      },
      {
        type: 'System.TimeoutException',
        count: 64,
        firstSeen: '2026-07-25T07:00:00.000Z',
        lastSeen: '2026-07-25T09:00:00.000Z',
      },
    ],
  })),
  getHistogram: vi.fn(async () => ({ buckets: [] })),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  localStorage.setItem('logharbor-lang', 'en')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <ExceptionsPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  )
}

it('lists exception groups under a narrative headline', async () => {
  renderPage()
  expect(await screen.findByText('System.NullReferenceException')).toBeDefined()
  // headline totals the groups: 88 + 64
  expect(screen.getByText('152 exceptions in this range.')).toBeDefined()
})

it('starts live and pauses into a static range picker', async () => {
  renderPage()
  const toggle = await screen.findByRole('button', { name: /Live/ })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByTitle('Time range')).toBeNull()

  toggle.click()
  expect(await screen.findByTitle('Time range')).toBeDefined()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/pages/ExceptionsPage.test.tsx`
Expected: FAIL — `ExceptionsPage` module not found.

- [ ] **Step 3: Add the filter helper and i18n keys**

Append to `frontend/src/lib/filter.ts`:

```ts
/**
 * Matches events whose exception text starts with a top-exceptions group type.
 * `%`/`_` inside the type would act as LIKE wildcards; exception type names
 * don't contain them in practice.
 */
export function exceptionStartsWith(type: string): string {
  return `@Exception like ${quote(`${type}%`)}`
}
```

`frontend/src/i18n/en.ts` — add to `nav`: `exceptions: 'Exceptions',` and a new top-level section after `requests`:

```ts
  exceptions: {
    title: 'Exceptions',
    headline: (count: number) => `${count} exception${count === 1 ? '' : 's'} in this range.`,
  },
```

`frontend/src/i18n/tr.ts` — add to `nav`: `exceptions: 'İstisnalar',` and:

```ts
  exceptions: {
    title: 'İstisnalar',
    headline: (count: number) => `Bu aralıkta ${count} istisna.`,
  },
```

- [ ] **Step 4: Implement ExceptionsPage**

Create `frontend/src/pages/ExceptionsPage.tsx` (the live loop mirrors `DashboardPage`):

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useTopExceptions } from '../hooks/useStats'
import { LiveToggle } from '../components/dashboard/LiveToggle'
import { Sparkline } from '../components/Sparkline'
import { TimeRangePicker } from '../components/TimeRangePicker'
import { Card } from '../components/ui/Card'
import { formatTimestamp } from '../lib/dates'
import { exceptionStartsWith } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50
const REFRESH_MS = 10_000
const LIVE_WINDOW_MS = 60 * 60 * 1000 // rolling last hour

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

// floor to the refresh interval so the query keys stay stable within a tick
function flooredNow() {
  return Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS
}

export function ExceptionsPage() {
  const { t, lang } = useI18n()
  const [live, setLive] = useState(true)
  const [now, setNow] = useState(flooredNow)
  const [frozen, setFrozen] = useState<{ from: string; to: string } | null>(null)

  const liveRange = useMemo(
    () => ({ from: new Date(now - LIVE_WINDOW_MS).toISOString(), to: new Date(now).toISOString() }),
    [now],
  )
  const range = live ? liveRange : (frozen ?? liveRange)

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(flooredNow()), REFRESH_MS)
    return () => clearInterval(id)
  }, [live])

  function toggleLive() {
    if (live) {
      setFrozen(range)
      setLive(false)
    } else {
      setNow(flooredNow())
      setFrozen(null)
      setLive(true)
    }
  }

  const exceptions = useTopExceptions({ ...range, limit: ROW_LIMIT })
  const rows = exceptions.data?.exceptions ?? []
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t.exceptions.title}</h1>
        <div className="flex items-center gap-2">
          <LiveToggle live={live} onToggle={toggleLive} />
          {!live && (
            <TimeRangePicker
              from={range.from}
              to={range.to}
              onChange={(next) => {
                if (next.from) setFrozen({ from: next.from, to: next.to ?? new Date().toISOString() })
              }}
            />
          )}
        </div>
      </div>

      {exceptions.error && (
        <p className="bg-level-error/10 p-2 text-sm text-level-error">{exceptions.error.message}</p>
      )}

      {exceptions.data && <p className="text-xl font-semibold text-fg">{t.exceptions.headline(total)}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={TH_CLASS}>{t.analysis.exceptionType}</th>
              <th className={`${TH_CLASS} text-right`}>{t.analysis.count}</th>
              <th className={TH_CLASS}>{t.analysis.trend}</th>
              <th className={TH_CLASS}>{t.analysis.firstSeen}</th>
              <th className={TH_CLASS}>{t.analysis.lastSeen}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type} className="border-b border-border last:border-b-0">
                <td className={`${TD_CLASS} font-mono`}>{row.type}</td>
                <td className={`${TD_CLASS} tabular text-right`}>{row.count.toLocaleString(lang)}</td>
                <td className={TD_CLASS}>
                  <Sparkline
                    filter={exceptionStartsWith(row.type)}
                    color={LEVEL_HEX.Error}
                    from={range.from}
                    to={range.to}
                  />
                </td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {exceptions.data && rows.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">{t.analysis.noExceptions}</p>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Wire the route and the sidebar item**

- `frontend/src/App.tsx`: add `import { ExceptionsPage } from './pages/ExceptionsPage'` and, after the `/requests` route, `<Route path="/exceptions" element={<ExceptionsPage />} />`.
- `frontend/src/components/Sidebar.tsx`: in the `groupActivity` group, after the Requests item, add `{ to: '/exceptions', label: t.nav.exceptions },`.

- [ ] **Step 6: Run the tests**

Run: `npm run test -- src/pages/ExceptionsPage.test.tsx` then `npm run test`
Expected: new tests PASS; full suite stays green.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "feat(exceptions): live exception feed page"
```

---

### Task 4: Exception context panel

**Files:**
- Create: `frontend/src/components/exceptions/ExceptionContextPanel.tsx`
- Modify: `frontend/src/pages/ExceptionsPage.tsx` (row expansion)
- Modify: `frontend/src/pages/ExceptionsPage.test.tsx` (context tests)
- Modify: `frontend/src/i18n/en.ts` + `tr.ts` (context keys)

**Interfaces:**
- Consumes: `getEvents({ filter, from, to, count })` from `../../api/events` (returns `{ events: Event[]; hasMore: boolean; archivedDays: string[] }`, newest first; `Event` has `id`, `timestamp`, `level`, `message`, `messageTemplate`, `properties`, `exception`, `ingestedAt`, `traceId`, `spanId`); `exceptionStartsWith(type)` and `quote(value)` from `../../lib/filter`; `LevelBadge` (`level: Level`); `formatTimestamp`.
- Produces: `export function ExceptionContextPanel({ type, from, to }: { type: string; from: string; to: string })`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/pages/ExceptionsPage.test.tsx` — a `vi.mock` for the events API next to the stats mock (top level of the file), and two tests:

```tsx
import type { Event } from '../types'

const LATEST: Event = {
  id: 2,
  timestamp: '2026-07-25T09:30:00.000Z',
  level: 'Error',
  message: 'Order 42 failed',
  messageTemplate: 'Order {OrderId} failed',
  properties: null,
  exception: 'System.NullReferenceException: object was null\n   at OrderService.Ship()',
  ingestedAt: '2026-07-25T09:30:01.000Z',
  traceId: 'abc123def456',
  spanId: null,
}

const SIBLING: Event = {
  id: 1,
  timestamp: '2026-07-25T09:29:58.000Z',
  level: 'Information',
  message: 'Order 42 received',
  messageTemplate: null,
  properties: null,
  exception: null,
  ingestedAt: '2026-07-25T09:29:59.000Z',
  traceId: 'abc123def456',
  spanId: null,
}

vi.mock('../api/events', () => ({
  getEvents: vi.fn(async (params: { filter?: string }) => ({
    // newest first, like the real API
    events: params.filter?.startsWith('@TraceId') ? [LATEST, SIBLING] : [LATEST],
    hasMore: false,
    archivedDays: [],
  })),
}))
```

```tsx
it('expands a row into the latest occurrence with its same-trace events', async () => {
  renderPage()
  ;(await screen.findByText('System.NullReferenceException')).click()

  expect(await screen.findByText('Latest occurrence')).toBeDefined()
  expect(screen.getByText(/object was null/)).toBeDefined()
  // the sibling event of the same trace, oldest first
  expect(await screen.findByText('Order 42 received')).toBeDefined()

  const trace = screen.getByText('View full trace ↗') as HTMLAnchorElement
  expect(trace.getAttribute('href')).toContain(encodeURIComponent("@TraceId = 'abc123def456'"))
})

it('collapses the context panel when the row is clicked again', async () => {
  renderPage()
  ;(await screen.findByText('System.NullReferenceException')).click()
  await screen.findByText('Latest occurrence')

  screen.getByText('System.NullReferenceException').click()
  expect(screen.queryByText('Latest occurrence')).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/pages/ExceptionsPage.test.tsx`
Expected: the two new tests FAIL (no expansion behavior); the Task 3 tests still pass.

- [ ] **Step 3: Add the i18n keys**

`frontend/src/i18n/en.ts`, inside `exceptions`:

```ts
    latestOccurrence: 'Latest occurrence',
    sameTrace: 'Same-trace events',
    viewFullTrace: 'View full trace',
    noTraceContext: 'The latest occurrence carries no trace id, so there is no surrounding context to show.',
```

`frontend/src/i18n/tr.ts`, inside `exceptions`:

```ts
    latestOccurrence: 'Son oluşum',
    sameTrace: 'Aynı izdeki olaylar',
    viewFullTrace: 'İzin tamamını görüntüle',
    noTraceContext: 'Son oluşumda iz kimliği yok; çevresindeki bağlam gösterilemiyor.',
```

- [ ] **Step 4: Implement the panel**

Create `frontend/src/components/exceptions/ExceptionContextPanel.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { Event } from '../../types'
import { getEvents } from '../../api/events'
import { LevelBadge } from '../LevelBadge'
import { formatTimestamp } from '../../lib/dates'
import { exceptionStartsWith, quote } from '../../lib/filter'
import { useI18n } from '../../i18n'

interface ExceptionContextPanelProps {
  type: string
  from: string
  to: string
}

/** Inline context for one exception group: its latest occurrence plus the same-trace events around it. */
export function ExceptionContextPanel({ type, from, to }: ExceptionContextPanelProps) {
  const { t, lang } = useI18n()

  const latestQuery = useQuery({
    queryKey: ['exception-context', type, from, to],
    queryFn: () => getEvents({ filter: exceptionStartsWith(type), from, to, count: 1 }),
  })
  const latest: Event | undefined = latestQuery.data?.events[0]

  const traceQuery = useQuery({
    queryKey: ['trace', latest?.traceId],
    queryFn: () => getEvents({ filter: `@TraceId = ${quote(latest!.traceId!)}`, count: 1000 }),
    enabled: Boolean(latest?.traceId),
  })
  // the API returns newest first; the story reads top-down in time order
  const traceEvents = [...(traceQuery.data?.events ?? [])].reverse()

  if (latestQuery.isLoading) return <p className="p-3 text-sm text-fg-muted">{t.common.loading}</p>
  if (!latest) return null

  return (
    <div className="flex flex-col gap-3 bg-surface p-3">
      <div>
        <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t.exceptions.latestOccurrence}</p>
        <p className="mt-1 text-sm text-fg">
          <span className="mr-2 whitespace-nowrap text-fg-muted">{formatTimestamp(latest.timestamp, lang)}</span>
          {latest.message}
        </p>
        {latest.exception && (
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-raised p-2 text-xs whitespace-pre-wrap text-fg">
            {latest.exception}
          </pre>
        )}
      </div>
      {latest.traceId ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t.exceptions.sameTrace}</p>
            <Link
              to={`/events?${new URLSearchParams({ filter: `@TraceId = ${quote(latest.traceId)}` }).toString()}`}
              className="text-xs text-fg-muted transition-colors hover:text-accent"
            >
              {t.exceptions.viewFullTrace} ↗
            </Link>
          </div>
          <ul className="mt-1 max-h-64 overflow-y-auto">
            {traceEvents.map((event) => (
              <li
                key={event.id}
                className={`flex items-baseline gap-2 border-b border-border px-1 py-1 text-sm last:border-b-0 ${
                  event.id === latest.id ? 'bg-surface-raised' : ''
                }`}
              >
                <span className="whitespace-nowrap text-xs text-fg-muted">{formatTimestamp(event.timestamp, lang)}</span>
                <LevelBadge level={event.level} />
                <span className="min-w-0 truncate text-fg">{event.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t.exceptions.noTraceContext}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Wire the expansion into ExceptionsPage**

In `frontend/src/pages/ExceptionsPage.tsx`:
- Add imports: `import { Fragment } from 'react'` (merge into the existing react import) and `import { ExceptionContextPanel } from '../components/exceptions/ExceptionContextPanel'`.
- Add UI state next to the others: `const [expandedType, setExpandedType] = useState<string | null>(null)`.
- Replace the `rows.map((row) => (...))` body so each row toggles and renders the panel row:

```tsx
            {rows.map((row) => (
              <Fragment key={row.type}>
                <tr
                  onClick={() => setExpandedType(expandedType === row.type ? null : row.type)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
                >
                  <td className={`${TD_CLASS} font-mono`}>{row.type}</td>
                  <td className={`${TD_CLASS} tabular text-right`}>{row.count.toLocaleString(lang)}</td>
                  <td className={TD_CLASS}>
                    <Sparkline
                      filter={exceptionStartsWith(row.type)}
                      color={LEVEL_HEX.Error}
                      from={range.from}
                      to={range.to}
                    />
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.firstSeen, lang)}</td>
                  <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(row.lastSeen, lang)}</td>
                </tr>
                {expandedType === row.type && (
                  <tr className="border-b border-border last:border-b-0">
                    <td colSpan={5} className="p-0">
                      <ExceptionContextPanel type={row.type} from={range.from} to={range.to} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- src/pages/ExceptionsPage.test.tsx` then `npm run test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "feat(exceptions): inline trace-context panel on the exception feed"
```

---

### Task 5: Section-header chips, docs, full verification

**Files:**
- Modify: `frontend/src/components/dashboard/SectionHeader.tsx`
- Modify: `docs/frontend.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — visual polish + docs.

- [ ] **Step 1: Style the section-header link as a Nightwatch chip**

In `frontend/src/components/dashboard/SectionHeader.tsx`, replace the `Link` className so the "view all ↗" reads as a small bordered button (spec §Visual language):

```tsx
        <Link
          to={to}
          className="rounded-lg border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {linkLabel} ↗
        </Link>
```

- [ ] **Step 2: Update docs/frontend.md**

- Replace the nav-order line (`Nav order: Dashboard (home, /), Services, Users, Analysis, Signals, Alerts, Events`) with:

```
Nav: grouped left sidebar (drawer on small screens) — Overview (home, /);
Activity: Events, Requests, Exceptions; Analysis: Analysis, Services, Users;
System: Signals, Alerts, Settings
```

- In the structure listing, add `RequestsPage, ExceptionsPage` to the `pages/` line and change `NavBar` mentions to `Sidebar` (grep the file for `NavBar` and `nav bar`; the TR/EN toggle and the theme toggle now live at the sidebar's bottom).
- Add two page sections after the Users page section, in the file's existing style:

```
--- REQUESTS PAGE (/requests) ---

The operations RED table as its own lens: one row per message template with
events/min, error %, p95 Elapsed and a trend sparkline (GET
/api/stats/operations, limit 50). Numeric column headers re-sort client-side
(descending). Row click: navigates to Events filtered by that template for
the range.

--- EXCEPTIONS PAGE (/exceptions) ---

Live exception feed: one row per exception group (type, count, trend
sparkline, first/last seen) from GET /api/stats/top-exceptions over a rolling
last-hour window refreshed every 10 s, with the dashboard's Live toggle.
Row click expands an inline context panel: the group's latest occurrence
(message + exception text via GET /api/events with @Exception like 'Type%')
and, when that event carries a trace id, the same-trace events in time order
with a "View full trace" link to Events filtered by @TraceId.
```

- [ ] **Step 3: Full verification**

Run (in `frontend/`): `npm run test` and `npm run build`
Run (repo root): `dotnet test backend`
Expected: everything green; the backend suite is untouched by this work.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/SectionHeader.tsx docs/frontend.md
git commit -m "feat(dashboard): chip-style section links; document sidebar and lens pages"
```
