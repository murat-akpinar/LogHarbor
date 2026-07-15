# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default-Tailwind look of the LogHarbor SPA with a deliberate visual identity — semantic colour tokens, Inter + JetBrains Mono, an emerald accent — without changing any behaviour.

**Architecture:** All colour, radius, shadow and font decisions move into a token layer in `frontend/src/index.css` (CSS custom properties on `:root` / `:root.dark`, exposed as Tailwind utilities through `@theme`). Components then stop naming raw palette colours (`bg-slate-900`, `text-blue-600`) and name roles instead (`bg-surface`, `text-accent`). Three shared primitives (`Button`, `Input`, `Card`) absorb the Tailwind class soup that is currently copy-pasted across ~20 form sites.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), oxlint. No test runner is installed — verification is `npm run lint`, `npm run build` (which runs `tsc -b`), and a grep gate proving no raw palette classes survive.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-14-frontend-redesign-design.md`. Read it before Task 1.
- **No behaviour changes.** No props removed, no handlers rewired, no routes touched. This is a visual layer only. `useLiveTail`, `useEventSearch`, the API clients and the query language are out of bounds.
- **No new dependencies** beyond `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`.
- **No raw Tailwind palette colours in `src/`** once Task 11 lands. Banned pattern: any class matching `-(slate|gray|zinc|blue|red|amber|emerald|sky|indigo)-[0-9]{2,3}`. Use the tokens below. Semantic exceptions are allowed *only* inside `src/lib/levels.ts` (hex values for chart fills) and `src/index.css` (the token definitions themselves).
- **Canonical token map.** Every task replaces old classes using exactly this table:

| Old (any occurrence) | New |
|---|---|
| `bg-slate-50` / `bg-slate-950` (page background) | `bg-bg` |
| `bg-white` / `bg-slate-900` (panel, card) | `bg-surface` |
| `hover:bg-slate-100` / `dark:hover:bg-slate-800` | `hover:bg-surface-hover` |
| `bg-slate-100` / `bg-slate-800` (selected, dropdown) | `bg-surface-raised` |
| `border-slate-200` / `dark:border-slate-800` | `border-border` |
| `border-slate-300` / `dark:border-slate-700` (inputs) | `border-border-strong` |
| `text-slate-900` / `dark:text-slate-100` | `text-fg` |
| `text-slate-500` / `text-slate-600` / `dark:text-slate-400` | `text-fg-muted` |
| `placeholder:text-slate-400` / `dark:placeholder:text-slate-600` | `placeholder:text-fg-subtle` |
| `bg-blue-600 text-blue-50 hover:bg-blue-500` (primary button) | use `<Button variant="primary">` |
| `focus:border-blue-500` | `focus:border-accent focus:ring-2 focus:ring-accent/30` |
| `text-red-600` / `dark:text-red-400` (error text) | `text-level-error` |
| `bg-red-50` / `dark:bg-red-950` (error banner) | `bg-level-error/10` |

  A dark: variant is no longer needed for any of these — the token already carries both themes.

- **Verification after every task:** `npm run lint` and `npm run build` must both pass from `frontend/`. Commit only when they do.
- **Commit style:** `feat(ui): <what>`, one commit per task.

---

### Task 1: Token layer and fonts

This is the foundation. Nothing else works until `index.css` defines the tokens.

**Files:**
- Modify: `frontend/package.json` (two dependencies)
- Modify: `frontend/src/index.css` (full rewrite)
- Modify: `frontend/src/main.tsx` (font imports)

**Interfaces:**
- Consumes: nothing.
- Produces: the Tailwind utilities every later task uses — `bg-bg`, `bg-surface`, `bg-surface-hover`, `bg-surface-raised`, `border-border`, `border-border-strong`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `bg-accent`, `text-accent`, `text-accent-fg`, `hover:bg-accent-hover`, `text-level-{fatal,error,warning,information,debug,verbose}` (and their `bg-`/`border-` forms), `font-sans`, `font-mono`, `shadow-card`, `rounded-card`.

- [ ] **Step 1: Install the fonts**

From `frontend/`:

```bash
npm install @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

Both are self-hosted variable fonts. Vite bundles the `.woff2` as hashed assets, so the app never makes an external request — this is required, the deployment sits on an intranet where a CDN may be unreachable.

- [ ] **Step 2: Import the fonts before the stylesheet**

`frontend/src/main.tsx` — add the two imports above `./index.css` (order matters: the font faces must be registered before Tailwind's preflight sets the family):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Write the token layer**

Replace the entire contents of `frontend/src/index.css`:

```css
@import "tailwindcss";

/* dark: variant is toggled by a `dark` class on <html> (useTheme hook), not by OS preference alone */
@custom-variant dark (&:where(.dark, .dark *));

/* ---------------------------------------------------------------------------
   Token layer. Components name roles (surface, fg, accent), never raw palette
   colours. @theme cannot switch on a class, so the values live as custom
   properties on :root / :root.dark and @theme maps them into utility names.
   Changing the palette means changing this file and nothing else.
   --------------------------------------------------------------------------- */

:root {
  color-scheme: light;

  --logharbor-bg: #f7f8f8;
  --logharbor-surface: #ffffff;
  --logharbor-surface-hover: #f1f2f3;
  --logharbor-surface-raised: #ffffff;

  --logharbor-border: #e4e6e8;
  --logharbor-border-strong: #c9cdd2;

  --logharbor-fg: #16181b;
  --logharbor-fg-muted: #5b6169;
  --logharbor-fg-subtle: #8b9199;

  --logharbor-accent: #059669;
  --logharbor-accent-hover: #047857;
  --logharbor-accent-fg: #ffffff;

  --logharbor-level-fatal: #be123c;
  --logharbor-level-error: #dc2626;
  --logharbor-level-warning: #b45309;
  --logharbor-level-information: #52627a;
  --logharbor-level-debug: #6b7280;
  --logharbor-level-verbose: #94a3b8;

  /* drop shadows read on light backgrounds; on dark they are replaced by a border */
  --logharbor-shadow-card: 0 1px 2px rgb(16 24 40 / 0.04), 0 4px 12px rgb(16 24 40 / 0.06);
}

:root.dark {
  color-scheme: dark;

  /* a cool near-black: pure black is harsh on OLED, grey is lifeless */
  --logharbor-bg: #0b0c0e;
  --logharbor-surface: #131518;
  --logharbor-surface-hover: #17191d;
  --logharbor-surface-raised: #1b1e23;

  --logharbor-border: #262a30;
  --logharbor-border-strong: #3a3f47;

  --logharbor-fg: #e8eaed;
  --logharbor-fg-muted: #9ba1a9;
  --logharbor-fg-subtle: #6b717a;

  /* the same hex never reads the same in both themes, so the accent is tuned per theme */
  --logharbor-accent: #34d399;
  --logharbor-accent-hover: #6ee7b7;
  --logharbor-accent-fg: #04120c;

  --logharbor-level-fatal: #fb7185;
  --logharbor-level-error: #f87171;
  --logharbor-level-warning: #fbbf24;
  --logharbor-level-information: #8fa3b8;
  --logharbor-level-debug: #7c8590;
  --logharbor-level-verbose: #5f6771;

  --logharbor-shadow-card: 0 0 0 1px rgb(255 255 255 / 0.04);
}

@theme {
  --color-bg: var(--logharbor-bg);
  --color-surface: var(--logharbor-surface);
  --color-surface-hover: var(--logharbor-surface-hover);
  --color-surface-raised: var(--logharbor-surface-raised);

  --color-border: var(--logharbor-border);
  --color-border-strong: var(--logharbor-border-strong);

  --color-fg: var(--logharbor-fg);
  --color-fg-muted: var(--logharbor-fg-muted);
  --color-fg-subtle: var(--logharbor-fg-subtle);

  --color-accent: var(--logharbor-accent);
  --color-accent-hover: var(--logharbor-accent-hover);
  --color-accent-fg: var(--logharbor-accent-fg);

  --color-level-fatal: var(--logharbor-level-fatal);
  --color-level-error: var(--logharbor-level-error);
  --color-level-warning: var(--logharbor-level-warning);
  --color-level-information: var(--logharbor-level-information);
  --color-level-debug: var(--logharbor-level-debug);
  --color-level-verbose: var(--logharbor-level-verbose);

  --font-sans: "Inter Variable", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;

  --radius-card: 10px;
  --shadow-card: var(--logharbor-shadow-card);
}

/* cv05 = straight-tailed l, ss03 = single-storey a: fewer 1lI0O mix-ups in a log tool */
body {
  font-family: var(--font-sans);
  font-feature-settings: "cv05", "ss03";
  background-color: var(--color-bg);
  color: var(--color-fg);
}

/* timestamps and counters must not jitter as the virtualized list scrolls */
.tabular {
  font-variant-numeric: tabular-nums;
}

/* live-tail arrival flash (docs/frontend.md: new events prepend with highlight) */
@keyframes tail-in {
  from {
    background-color: color-mix(in oklab, var(--color-accent) 22%, transparent);
  }
  to {
    background-color: transparent;
  }
}

.animate-tail-in {
  animation: tail-in 900ms ease-out;
}
```

- [ ] **Step 4: Verify the tokens compile and the fonts are bundled**

```bash
npm run lint && npm run build
```

Expected: both pass, and the `vite build` asset list includes at least one `inter-*.woff2` and one `jetbrains-mono-*.woff2` under `dist/assets/`. Confirm with:

```bash
ls dist/assets | grep -Ei "inter|jetbrains"
```

Expected: at least two `.woff2` files listed. If the list is empty the font imports in `main.tsx` are wrong — fix before continuing, every later task depends on this.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/index.css frontend/src/main.tsx
git commit -m "feat(ui): semantic token layer, Inter + JetBrains Mono"
```

---

### Task 2: Theme follows the system until the user chooses

`useTheme` currently writes to `localStorage` on first mount, so the app stops following the OS the moment it loads once. The spec wants system preference as the default, with an explicit choice persisting.

**Files:**
- Modify: `frontend/src/hooks/useTheme.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: unchanged public shape — `useTheme()` still returns `{ theme: 'light' | 'dark', toggleTheme: () => void }`. `App.tsx` and `NavBar.tsx` need no change.

- [ ] **Step 1: Rewrite the hook**

Replace `frontend/src/hooks/useTheme.ts`:

```ts
import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'logharbor-theme'

function storedTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : null
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  // null means "no explicit choice yet": keep following the OS
  const [chosen, setChosen] = useState<Theme | null>(storedTheme)
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme = chosen ?? system

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, next)
    setChosen(next)
  }

  return { theme, toggleTheme }
}
```

- [ ] **Step 2: Verify by hand**

```bash
npm run build && npm run dev
```

With no `logharbor-theme` key in localStorage (clear it in devtools), flipping the OS theme must flip the app live. After clicking the toggle once, the app must stop following the OS. Expected: both hold.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useTheme.ts
git commit -m "feat(ui): follow system theme until the user picks one"
```

---

### Task 3: Shared primitives (Button, Input, Card)

Today the same class string is copy-pasted across `LoginGate`, `SignalForm`, `AlertForm`, `SettingsPage` and both list pages. Extract it once so the later tasks are one-line replacements.

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Input.tsx`
- Create: `frontend/src/components/ui/Card.tsx`

**Interfaces:**
- Consumes: the tokens from Task 1.
- Produces:
  - `<Button variant?: 'primary' | 'secondary' | 'danger' | 'ghost'>` — extends `ButtonHTMLAttributes<HTMLButtonElement>`; default variant `secondary`.
  - `<Input>` — extends `InputHTMLAttributes<HTMLInputElement>`; adds `mono?: boolean` for filter/key fields.
  - `<Card>` — `{ children, className? }`.

- [ ] **Step 1: Write `Button`**

`frontend/src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-hover',
  danger: 'text-level-error hover:bg-level-error/10',
  ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  )
}
```

Note `type="button"` comes before `{...rest}` so a caller can still pass `type="submit"`.

- [ ] **Step 2: Write `Input`**

`frontend/src/components/ui/Input.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** filter expressions, API keys and other machine text read better in the mono face */
  mono?: boolean
}

export function Input({ mono = false, className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={`rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg transition-colors duration-150 placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none ${mono ? 'font-mono' : ''} ${className}`}
    />
  )
}
```

- [ ] **Step 3: Write `Card`**

`frontend/src/components/ui/Card.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-border bg-surface shadow-card ${className}`}>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
```

Expected: both pass. Nothing imports the primitives yet, so the bundle is unchanged in behaviour.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui
git commit -m "feat(ui): shared Button, Input and Card primitives"
```

---

### Task 4: Shell — App and NavBar

**Files:**
- Modify: `frontend/src/App.tsx:20` (the root `div` class)
- Modify: `frontend/src/components/NavBar.tsx` (full rewrite)

**Interfaces:**
- Consumes: tokens (Task 1), `Button` (Task 3).
- Produces: nothing new. `NavBar` keeps its exact props: `{ theme: Theme, onToggleTheme: () => void }`.

- [ ] **Step 1: Retoken the app shell**

In `frontend/src/App.tsx`, replace the root `div` className:

```tsx
<div className="flex h-screen flex-col bg-bg text-fg">
```

(was `bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100`.)

- [ ] **Step 2: Rewrite `NavBar`**

Replace `frontend/src/components/NavBar.tsx`:

```tsx
import { NavLink } from 'react-router-dom'
import type { Theme } from '../hooks/useTheme'
import { Button } from './ui/Button'

const LINKS = [
  { to: '/', label: 'Events', end: true },
  { to: '/dashboard', label: 'Dashboard', end: false },
  { to: '/analysis', label: 'Analysis', end: false },
  { to: '/signals', label: 'Signals', end: false },
  { to: '/alerts', label: 'Alerts', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

interface NavBarProps {
  theme: Theme
  onToggleTheme: () => void
}

export function NavBar({ theme, onToggleTheme }: NavBarProps) {
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
      <span className="mr-6 flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
        LogHarbor
      </span>
      {LINKS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'bg-surface-raised text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
      <Button
        variant="ghost"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="ml-auto"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </Button>
    </nav>
  )
}
```

- [ ] **Step 3: Verify**

```bash
npm run lint && npm run build
grep -nE "\-(slate|gray|zinc|blue)-[0-9]{2,3}" src/App.tsx src/components/NavBar.tsx
```

Expected: lint and build pass; the grep prints nothing (exit code 1 is the pass condition here).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/NavBar.tsx
git commit -m "feat(ui): retoken the app shell and nav"
```

---

### Task 5: Levels and the event row

The highest-traffic pixels in the product. The level moves from a filled badge to a coloured left bar plus a short code; Information stays neutral so the eye lands on Warning and Error.

**Files:**
- Modify: `frontend/src/lib/levels.ts`
- Modify: `frontend/src/components/LevelBadge.tsx`
- Modify: `frontend/src/components/EventRow.tsx`

**Interfaces:**
- Consumes: tokens (Task 1).
- Produces:
  - `LEVEL_TEXT: Record<Level, string>` — text colour class per level, e.g. `'text-level-error'`.
  - `LEVEL_BAR: Record<Level, string>` — background class for the 2px row bar, e.g. `'bg-level-error'`.
  - `LEVEL_CODE: Record<Level, string>` — three-letter code, e.g. `'ERR'`.
  - `LEVEL_HEX: Record<Level, string>` — unchanged name, new values; still the only place raw hex is allowed (chart fills cannot read Tailwind classes back).
  - `<LevelBadge level>` keeps its prop.

- [ ] **Step 1: Rewrite the level tables**

Replace `frontend/src/lib/levels.ts`:

```ts
import type { Level } from '../types'

export const LEVELS: Level[] = ['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal']

// docs/frontend.md LEVEL COLORS. Information is deliberately neutral: most events are
// Information, and if every level is coloured then none of them is.
export const LEVEL_TEXT: Record<Level, string> = {
  Verbose: 'text-level-verbose',
  Debug: 'text-level-debug',
  Information: 'text-level-information',
  Warning: 'text-level-warning',
  Error: 'text-level-error',
  Fatal: 'text-level-fatal',
}

export const LEVEL_BAR: Record<Level, string> = {
  Verbose: 'bg-level-verbose',
  Debug: 'bg-level-debug',
  Information: 'bg-level-information',
  Warning: 'bg-level-warning',
  Error: 'bg-level-error',
  Fatal: 'bg-level-fatal',
}

export const LEVEL_CODE: Record<Level, string> = {
  Verbose: 'VRB',
  Debug: 'DBG',
  Information: 'INF',
  Warning: 'WRN',
  Error: 'ERR',
  Fatal: 'FTL',
}

// same palette as the tokens, as raw hex for chart fills (Tailwind classes can't be read
// back from CSS). Dark-theme values: charts sit on surface in both themes and these read
// acceptably on either.
export const LEVEL_HEX: Record<Level, string> = {
  Verbose: '#94a3b8',
  Debug: '#6b7280',
  Information: '#8fa3b8',
  Warning: '#f59e0b',
  Error: '#dc2626',
  Fatal: '#be123c',
}
```

Note `LEVEL_COLORS` is gone. Task 6 and Task 8 fix the remaining importers; `npm run build` will name them if any are missed.

- [ ] **Step 2: Rewrite `LevelBadge`**

`frontend/src/components/LevelBadge.tsx` — a quiet mono code, not a filled pill:

```tsx
import type { Level } from '../types'
import { LEVEL_CODE, LEVEL_TEXT } from '../lib/levels'

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className={`font-mono text-xs font-medium ${LEVEL_TEXT[level]}`} title={level}>
      {LEVEL_CODE[level]}
    </span>
  )
}
```

- [ ] **Step 3: Rewrite the row body of `EventRow`**

In `frontend/src/components/EventRow.tsx`, keep every prop, the `columnValues` helper and the imports as they are. Replace only the returned JSX:

```tsx
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      style={style}
      className={`absolute inset-x-0 flex items-center gap-3 border-b border-border pr-3 pl-3 text-left text-sm transition-colors duration-150 hover:bg-surface-hover ${
        isSelected ? 'bg-surface-raised' : ''
      } ${isError ? 'bg-level-error/[0.06]' : ''} ${isNew ? 'animate-tail-in' : ''}`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-0.5 ${isSelected ? 'bg-accent' : LEVEL_BAR[event.level]}`}
        aria-hidden="true"
      />
      <span
        className={`tabular ${relativeTime ? 'w-24' : 'w-44'} shrink-0 font-mono text-xs text-fg-muted`}
        title={formatTimestamp(event.timestamp)}
      >
        {relativeTime ? formatRelative(event.timestamp) : formatTimestamp(event.timestamp)}
      </span>
      <span className="w-10 shrink-0">
        <LevelBadge level={event.level} />
      </span>
      {columnValues(event.properties, columns).map((value, index) => (
        <span
          key={columns[index]}
          className="w-32 shrink-0 truncate font-mono text-xs text-fg-muted"
          title={value}
        >
          {value}
        </span>
      ))}
      <span className="min-w-0 flex-1 truncate text-fg">
        <Highlighted text={event.message} terms={highlightTerms} />
      </span>
    </button>
  )
```

Add the two things that JSX now needs — the `isError` local, just above the `return`:

```tsx
  const isError = event.level === 'Error' || event.level === 'Fatal'
```

and extend the levels import at the top of the file:

```tsx
import { LEVEL_BAR } from '../lib/levels'
```

The level column shrinks from `w-24` to `w-10` because the badge is now a three-letter code; that width is what buys the message column its extra room.

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
```

Expected: both pass. A `LEVEL_COLORS is not exported` error here means Task 6/Task 8 files still import it — that is expected at this point *only* if the build names `LevelChips.tsx` or a chart; if so, jump to the relevant task's import fix and return. Do not leave the build red at commit time: if `npm run build` fails, apply the `LEVEL_TEXT`/`LEVEL_BAR` swap in the named file now and include it in this commit.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/levels.ts frontend/src/components/LevelBadge.tsx frontend/src/components/EventRow.tsx
git commit -m "feat(ui): quiet level codes and a coloured row bar"
```

---

### Task 6: Events page header and its controls

The current header packs six controls into one row. Split it: a full-width search bar on top, a 32px filter strip under it.

**Files:**
- Modify: `frontend/src/pages/EventsPage.tsx` (the header block, roughly lines 160–200 after Task 5)
- Modify: `frontend/src/components/SearchBar.tsx`
- Modify: `frontend/src/components/LevelChips.tsx`
- Modify: `frontend/src/components/SignalToggles.tsx`
- Modify: `frontend/src/components/TimeRangePicker.tsx`
- Modify: `frontend/src/components/ColumnPicker.tsx`
- Modify: `frontend/src/components/LiveTailToggle.tsx`

**Interfaces:**
- Consumes: tokens (Task 1), `Button`/`Input` (Task 3), `LEVEL_TEXT` (Task 5).
- Produces: no prop changes to any of these components.

- [ ] **Step 1: Retoken the six controls**

Apply the canonical token map from Global Constraints to every className in `SearchBar.tsx`, `LevelChips.tsx`, `SignalToggles.tsx`, `TimeRangePicker.tsx`, `ColumnPicker.tsx` and `LiveTailToggle.tsx`. Specific decisions that the map does not cover:

- `SearchBar` — the text input becomes `<Input mono className="w-full" />`; the suggestion dropdown sits on `bg-surface-raised` with `border-border` and `shadow-card`; the highlighted suggestion row is `bg-surface-hover text-fg`.
- `LevelChips` — an active chip is `border border-border-strong bg-surface-raised` with its label in `LEVEL_TEXT[level]`; an inactive chip is `text-fg-muted hover:bg-surface-hover`. If this file imported `LEVEL_COLORS`, that import becomes `LEVEL_TEXT`.
- `SignalToggles` — active toggle `bg-accent/15 text-accent border border-accent/30`, inactive `text-fg-muted hover:bg-surface-hover`. The accent means "a filter is live", which is exactly what a signal is.
- `LiveTailToggle` — when live, show a pulsing accent dot before the label: `<span className="size-1.5 animate-pulse rounded-full bg-accent" />`, label in `text-accent`. When idle, `text-fg-muted`.
- `ColumnPicker` / `TimeRangePicker` — trigger becomes `<Button variant="secondary">`; the popover uses `bg-surface-raised border-border shadow-card rounded-card`.

- [ ] **Step 2: Restructure the header in `EventsPage`**

In `frontend/src/pages/EventsPage.tsx`, replace the header block (the outer `div` holding `SearchBar` and the controls row) with two stacked rows:

```tsx
      <div className="shrink-0 border-b border-border bg-surface">
        <div className="p-3">
          <SearchBar initialText={initialFilter} onCommit={setSearchText} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <LevelChips activeLevels={activeLevels} onToggle={toggleLevel} />
            <SignalToggles activeSignalIds={activeSignalIds} onToggle={toggleSignal} />
          </div>
          <div className="flex items-center gap-2">
            {!isLive && <TimeRangePicker from={range.from} to={range.to} onChange={setRange} />}
            <ColumnPicker columns={columns} onChange={setColumns} />
            <Button variant="ghost" onClick={() => setRelativeTime((current) => !current)} title="Toggle relative timestamps">
              {relativeTime ? 'Relative time' : 'Absolute time'}
            </Button>
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              Export
              <a
                href={buildExportUrl({ filter, from: range.from, to: range.to, format: 'json' })}
                className="rounded-lg px-2 py-1 font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
              >
                JSON
              </a>
              <a
                href={buildExportUrl({ filter, from: range.from, to: range.to, format: 'csv' })}
                className="rounded-lg px-2 py-1 font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
              >
                CSV
              </a>
            </span>
            <LiveTailToggle isLive={isLive} status={tail.status} onToggle={toggleLive} />
          </div>
        </div>
      </div>
```

Import `Button` at the top of the file: `import { Button } from '../components/ui/Button'`.

- [ ] **Step 3: Retoken the rest of `EventsPage`**

Same file, apply the token map to: the two error banners (`bg-level-error/10 text-level-error`), the `Loading…` line, the pending-events resume button (`bg-accent text-accent-fg hover:bg-accent-hover`), and the keyboard-help modal (`bg-surface-raised border-border shadow-card`, `kbd` on `bg-surface-hover border-border`).

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
grep -rnE "\-(slate|gray|zinc|blue)-[0-9]{2,3}" src/pages/EventsPage.tsx src/components/SearchBar.tsx src/components/LevelChips.tsx src/components/SignalToggles.tsx src/components/TimeRangePicker.tsx src/components/ColumnPicker.tsx src/components/LiveTailToggle.tsx
```

Expected: lint and build pass; grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EventsPage.tsx frontend/src/components
git commit -m "feat(ui): two-row events header, retokened controls"
```

---

### Task 7: Event detail panel

**Files:**
- Modify: `frontend/src/components/EventDetail.tsx`
- Modify: `frontend/src/components/JsonTree.tsx`
- Modify: `frontend/src/components/Highlighted.tsx`

**Interfaces:**
- Consumes: tokens (Task 1), `Button` (Task 3), `LEVEL_TEXT` (Task 5).
- Produces: no prop changes.

- [ ] **Step 1: Retoken the panel**

Apply the token map across all three files. Decisions the map does not cover:

- Panel container: `w-[28rem] shrink-0 overflow-y-auto border-l border-border bg-surface`.
- Header row: level (`LEVEL_TEXT`, mono), timestamp (`font-mono text-xs text-fg-muted tabular`), close button as `<Button variant="ghost">`.
- Property table: name cell `text-fg-muted`, value cell `font-mono text-fg break-all`, row separator `border-border`.
- Exception block: `font-mono text-xs text-level-error whitespace-pre-wrap`, on `bg-level-error/[0.06]` with `rounded-card` padding.
- `Highlighted`: the match mark becomes `bg-accent/25 text-fg rounded-[3px] px-0.5` — the current yellow reads as a warning, which it is not.
- `JsonTree`: keys `text-fg-muted`, strings `text-fg`, numbers/booleans `text-accent`, null `text-fg-subtle`, all `font-mono text-xs`.

- [ ] **Step 2: Verify**

```bash
npm run lint && npm run build
grep -rnE "\-(slate|gray|zinc|blue|yellow)-[0-9]{2,3}" src/components/EventDetail.tsx src/components/JsonTree.tsx src/components/Highlighted.tsx
```

Expected: lint and build pass; grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/EventDetail.tsx frontend/src/components/JsonTree.tsx frontend/src/components/Highlighted.tsx
git commit -m "feat(ui): retoken the event detail panel"
```

---

### Task 8: Dashboard and Analysis

**Files:**
- Modify: `frontend/src/components/StatTile.tsx` (full rewrite)
- Modify: `frontend/src/components/Histogram.tsx`
- Modify: `frontend/src/components/Heatmap.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/AnalysisPage.tsx`

**Interfaces:**
- Consumes: tokens (Task 1), `Card` (Task 3), `LEVEL_HEX` / `LEVEL_TEXT` (Task 5).
- Produces: `StatTile` prop change — `accentClassName?: string` is replaced by `tone?: 'default' | Level`. Both pages must be updated in this task; no other file uses it.

- [ ] **Step 1: Rewrite `StatTile`**

`frontend/src/components/StatTile.tsx`:

```tsx
import type { Level } from '../types'
import { LEVEL_TEXT } from '../lib/levels'
import { Card } from './ui/Card'

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

interface StatTileProps {
  label: string
  value: number
  /** 'default' is the neutral total; a Level tints the figure with that level's colour */
  tone?: 'default' | Level
}

export function StatTile({ label, value, tone = 'default' }: StatTileProps) {
  const toneClass = tone === 'default' ? 'text-fg' : LEVEL_TEXT[tone]
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={`tabular text-2xl font-semibold ${toneClass}`}>{formatCompact(value)}</p>
    </Card>
  )
}
```

- [ ] **Step 2: Update both pages' `StatTile` call sites**

In `DashboardPage.tsx` and `AnalysisPage.tsx`, every `accentClassName={...}` becomes `tone={...}`: a tile counting errors passes `tone="Error"`, a warnings tile `tone="Warning"`, a totals tile passes nothing. Retoken the rest of both pages with the token map (section headings `text-fg`, secondary text `text-fg-muted`, tables and panels wrapped in `<Card>`, table row separators `border-border`, deep-link rows `hover:bg-surface-hover`).

- [ ] **Step 3: Retoken the charts**

`Histogram.tsx`: bars use `fill="var(--color-accent)"`, error bars `LEVEL_HEX.Error`; axis lines and labels `stroke`/`fill` from `var(--color-border)` and `var(--color-fg-muted)`; axis number labels get `className="tabular"`. `Heatmap.tsx`: the cell scale runs accent → warning → error, i.e. interpolate between `var(--color-accent)`, `LEVEL_HEX.Warning` and `LEVEL_HEX.Error`; empty cells `var(--color-surface-hover)`.

Because these are SVG fills, referencing the CSS custom properties directly means the charts follow the theme with no JS.

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
grep -rnE "\-(slate|gray|zinc|blue)-[0-9]{2,3}" src/components/StatTile.tsx src/components/Histogram.tsx src/components/Heatmap.tsx src/pages/DashboardPage.tsx src/pages/AnalysisPage.tsx
```

Expected: lint and build pass; grep prints nothing. A TypeScript error about `accentClassName` means a call site was missed — fix it, the compiler is the check here.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StatTile.tsx frontend/src/components/Histogram.tsx frontend/src/components/Heatmap.tsx frontend/src/pages/DashboardPage.tsx frontend/src/pages/AnalysisPage.tsx
git commit -m "feat(ui): retoken dashboard, analysis and charts"
```

---

### Task 9: Signals, Alerts and Settings

**Files:**
- Modify: `frontend/src/pages/SignalsPage.tsx`
- Modify: `frontend/src/pages/AlertsPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/components/SignalForm.tsx`
- Modify: `frontend/src/components/AlertForm.tsx`
- Modify: `frontend/src/components/ArchivedRangeBanner.tsx`

**Interfaces:**
- Consumes: tokens (Task 1), `Button` / `Input` / `Card` (Task 3).
- Produces: no prop changes.

- [ ] **Step 1: Replace every hand-rolled input and button**

Across all six files: every `<input>` becomes `<Input>` (add `mono` on the filter-expression field in `SignalForm` and on API key fields in `SettingsPage`); every save/create button becomes `<Button type="submit" variant="primary">`; every delete/revoke button becomes `<Button variant="danger">`; every cancel becomes `<Button variant="secondary">`. Each list section and settings panel is wrapped in `<Card className="p-4">`. Apply the token map to whatever className text remains.

`ArchivedRangeBanner` is an information banner, not an error: `bg-accent/10 border border-accent/25 text-fg` with the hydrate action as `<Button variant="primary">`.

- [ ] **Step 2: Verify**

```bash
npm run lint && npm run build
grep -rnE "\-(slate|gray|zinc|blue)-[0-9]{2,3}" src/pages/SignalsPage.tsx src/pages/AlertsPage.tsx src/pages/SettingsPage.tsx src/components/SignalForm.tsx src/components/AlertForm.tsx src/components/ArchivedRangeBanner.tsx
```

Expected: lint and build pass; grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SignalsPage.tsx frontend/src/pages/AlertsPage.tsx frontend/src/pages/SettingsPage.tsx frontend/src/components/SignalForm.tsx frontend/src/components/AlertForm.tsx frontend/src/components/ArchivedRangeBanner.tsx
git commit -m "feat(ui): retoken signals, alerts and settings on the shared primitives"
```

---

### Task 10: Login gate

The first screen anyone sees, and the cheapest place to buy a good first impression.

**Files:**
- Modify: `frontend/src/components/LoginGate.tsx`

**Interfaces:**
- Consumes: tokens (Task 1), `Button` / `Input` / `Card` (Task 3).
- Produces: no prop changes. `LoginGate`, `LoginForm` and `PasswordChangeForm` keep their current logic exactly — only the markup changes.

- [ ] **Step 1: Replace the local `FIELD` / `SUBMIT` constants and the local `Card`**

Delete the `FIELD` and `SUBMIT` string constants and the local `Card` function. Import the primitives instead:

```tsx
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Card } from './ui/Card'
```

Add a local shell that both forms render into (keep the name `Shell` so it does not collide with the imported `Card`):

```tsx
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen items-center justify-center bg-bg">
      {/* a faint accent wash behind the card: the only decorative flourish in the app */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--color-accent),transparent_70%)] opacity-[0.07]"
      />
      <Card className="relative w-80 p-6">
        <h1 className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          LogHarbor
        </h1>
        <p className="mb-5 text-xs text-fg-muted">Structured log server</p>
        {children}
      </Card>
    </div>
  )
}
```

Then in both forms: every `<Card>` wrapper becomes `<Shell>`, every `<input ... className={FIELD} />` becomes `<Input ... className="mb-2 w-full" />`, and the submit becomes:

```tsx
<Button type="submit" variant="primary" disabled={loginMutation.isPending} className="mt-1 w-full">
  {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
</Button>
```

(and the same shape with `changeMutation` / `'Saving…'` / `'Set password'` in `PasswordChangeForm`).

Error text becomes `text-level-error`; the `Loading…` line becomes `text-fg-muted`.

- [ ] **Step 2: Verify by hand**

```bash
npm run lint && npm run build && npm run dev
```

Sign out (or clear the session cookie) and load the app in both themes. Expected: the card is centred, the accent wash is barely perceptible rather than a coloured blob, and both forms still submit.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LoginGate.tsx
git commit -m "feat(ui): rebuild the login gate on the shared primitives"
```

---

### Task 11: Sweep, docs, end-to-end verification

**Files:**
- Modify: whichever files the grep gate names
- Modify: `docs/frontend.md` (the LEVEL COLORS section and any palette wording)

**Interfaces:**
- Consumes: everything.
- Produces: the guarantee that the token layer is the only place colours are defined.

- [ ] **Step 1: Run the gate across the whole source tree**

From `frontend/`:

```bash
grep -rnE "\-(slate|gray|zinc|blue|red|amber|emerald|sky|indigo|yellow)-[0-9]{2,3}" src/ --include=*.tsx --include=*.ts
```

Expected: no output. Any hit is a file a previous task missed — fix it with the token map. `src/lib/levels.ts` holds raw hex (not Tailwind classes) and will not match this pattern; that is the one intended exception.

- [ ] **Step 2: Check for orphaned skeletons and empty states**

`VirtualizedEventList.tsx` and the `Loading…` strings in the pages: replace each spinner/text with a skeleton row block where a list is loading:

```tsx
<div className="animate-pulse space-y-px p-3">
  {Array.from({ length: 8 }, (_, index) => (
    <div key={index} className="h-7 rounded bg-surface-hover" />
  ))}
</div>
```

and, where a search returns nothing, a centred empty state:

```tsx
<div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
  <p>No events match this filter.</p>
  <Button variant="secondary" onClick={onClear}>Clear the filter</Button>
</div>
```

Wire `onClear` to the existing state setter that resets the search text — do not add new state.

- [ ] **Step 3: Update the frontend doc**

In `docs/frontend.md`, rewrite the LEVEL COLORS section to describe the token names (`--color-level-*`) and the "Information stays neutral" rule, and add a short DESIGN TOKENS section pointing at `src/index.css` as the single source of truth for colour, radius, shadow and fonts. Keep the existing structure and tone of the file.

- [ ] **Step 4: Full verification**

```bash
npm run lint && npm run build
cd .. && dotnet test backend
```

Expected: lint clean, build succeeds, backend tests green (nothing here touches them — a failure means something went badly wrong).

Then run the project's `verify` skill to boot the backend with the built SPA and walk all six pages in both themes, capturing screenshots. Confirm by eye: no unstyled flash on load (fonts are bundled), the event list scrolls without the timestamp column jittering, error rows are visibly tinted, live tail flashes in emerald.

- [ ] **Step 5: Commit**

```bash
git add frontend/src docs/frontend.md
git commit -m "feat(ui): skeleton and empty states, palette sweep, doc update"
```

---

## Notes for the implementer

- The token map in Global Constraints is the whole job. Most tasks are mechanical class substitution; the only real design work is in Tasks 5 (event row) and 10 (login gate).
- Resist adding `dark:` variants. If you feel the need for one, the token is wrong — fix the token, not the component.
- There is no test runner. `npm run build` runs `tsc -b`, so the compiler is your safety net: keep prop shapes stable and it will catch the rest.
