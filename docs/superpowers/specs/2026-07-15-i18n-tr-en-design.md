# TR/EN Language Support (i18n) — Design

Date: 2026-07-15
Status: Approved

## Goal

Add Turkish (TR) and English (EN) language support to the LogHarbor web UI. All
user-facing chrome text (menus, buttons, labels, empty states, tooltips,
aria-labels) is translatable; log data itself is not.

## Decisions

- **Scope:** Web UI only. Backend API messages, log data, and docs stay English.
- **Default language:** Detected from the browser (`navigator.language`
  starting with `tr` → Turkish, otherwise English). An explicit user choice is
  persisted to `localStorage` under `logharbor-lang` and wins thereafter —
  same pattern as the theme preference (`useTheme`).
- **Switcher:** A small button in the NavBar next to the theme toggle. Shows
  the current language code (`TR`/`EN`); clicking toggles to the other.
- **Dates:** Timestamp and relative-time formatting follow the selected app
  language (the selected locale is passed to `Intl` APIs), so the UI reads as
  one consistent language.
- **Approach:** Lightweight custom i18n — typed dictionaries + React context.
  No new dependencies. Chosen over react-i18next (unneeded features, runtime
  key resolution, 3 extra deps for 2 locales) and Lingui/react-intl (build
  step and catalog tooling, clearly oversized here).

## Architecture

New folder `frontend/src/i18n/`:

- **`en.ts`** — source dictionary. Nested object grouped by area (`nav`,
  `events`, `signals`, `alerts`, `settings`, `analysis`, `dashboard`, `login`,
  `common`, ...). `export type Messages = typeof en` derives the schema.
- **`tr.ts`** — `const tr: Messages = { ... }`. A missing or extra key is a
  **compile error**; the dictionaries cannot drift apart.
- **`index.tsx`** — `LanguageProvider` and `useI18n()` hook returning
  `{ t, lang, setLang }`, where `t` is the typed dictionary object for the
  active language. Usage is direct property access (`t.nav.events`) — no
  string keys, no runtime lookup magic.
- Parameterized strings are **functions** in the dictionary, e.g.
  `deleteConfirm: (name: string) => `...``. No interpolation engine needed.

Language type: `type Lang = 'en' | 'tr'`.

Detection order (on first load): `localStorage['logharbor-lang']` →
`navigator.language` prefix `tr` → `'en'`. `setLang` persists to localStorage.
The provider keeps `<html lang>` in sync with the active language.

## Components and data flow

- `LanguageProvider` wraps the tree in `App.tsx` **outside** `LoginGate`, so
  the login screen is translatable too.
- `NavBar` gains the TR/EN toggle button (ghost variant, next to the theme
  toggle), with a translated `aria-label`/`title`.
- All hardcoded UI strings in `frontend/src/components/` and
  `frontend/src/pages/` (~33 files) are replaced with `t.*` references,
  including `aria-label`, `title`, and `placeholder` attributes. This is the
  bulk of the work and is mechanical.
- `lib/dates.ts`: `formatTimestamp` and `formatRelative` take a locale
  parameter; `Intl.RelativeTimeFormat` instances are cached per locale in a
  `Map`. Call sites pass the locale obtained from `useI18n()`.

## Out of scope (deliberately not translated)

- Log event data: message templates, rendered messages, property names/values.
- Log level names (`Verbose`, `Debug`, `Information`, `Warning`, `Error`,
  `Fatal`) — these are field values coming from the data.
- Query language syntax, filter keywords, and autocomplete suggestions for
  the query language — technical syntax stays English.
- Backend API responses/validation messages, Swagger, and `docs/`.

## Error handling

There is no "missing translation" runtime state: the type system guarantees
key parity at compile time, so no fallback mechanism is needed or built.

## Testing (Vitest)

- Detection priority: localStorage beats `navigator.language` beats `'en'`
  default; invalid stored values fall through to detection.
- `setLang` persists the choice and updates `<html lang>`.
- A recursive test asserting `tr` contains no empty strings (type system
  already guarantees key parity).
- `formatTimestamp`/`formatRelative` produce locale-appropriate output for
  `en` vs `tr`.
- One component test: switching language re-renders visible text (e.g. NavBar
  link labels change from English to Turkish).
