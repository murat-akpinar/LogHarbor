# Search Filter Chips — Design

**Date:** 2026-07-15
**Status:** approved for planning

## Context

The event search box (`SearchBar`) accepts the full LogHarbor query language
(`@Level = 'Error' and RequestPath like '/api/%'`). It already has
autocomplete against `/api/search/suggest` (field names and per-field values),
keyboard navigation, history and validation. But suggestions only appear
**after you start typing**, and you must know the query syntax. New users
staring at an empty box see nothing to pick from.

The request: a Kibana/ELK-style experience — click the search area and pick
from selectable options (field → operator → value) without writing syntax,
shown as removable filter **chips**.

Good news that shapes the design: the backend already returns everything
needed. `/api/search/suggest` with no `property` returns matching **field
names**; with a `property` it returns that field's **values**. **No backend
change is required.**

## Goal

Structured filtering by building removable chips, no syntax required, with an
"edit as query" escape hatch to the existing raw box for power users.

## Non-goals

- No OR / NOT / parentheses in the chip UI (AND-only; use "edit as query").
- No backend changes.
- No change to signals, level quick-toggles, export, or live tail wiring.

## UX model — chips only, with an escape hatch

Replaces the `SearchBar` in the Events header top row with a `FilterBar`:

```
[ 'timeout' ✕ ]  [ Level is Error ✕ ]  [ + Add filter ]         Edit as query
```

- The committed filter is all chips joined by ` and `.
- `+ Add filter` opens the editor popover (field → operator → value).
- Clicking a chip body reopens the same popover **pre-filled** to edit it; `✕` removes it.
- `Edit as query` switches to the existing raw `SearchBar` (full language, all its
  autocomplete/history intact). Committing there tries to parse back to chips;
  if it can't, the raw string still runs as the filter (chips hidden) with a
  `Clear` to start over — no filter is ever lost.

The existing `LevelChips` quick-toggles stay as-is. A Level chip in the
FilterBar overlaps them; that's acceptable (the toggles are shortcuts, the chip
is part of the query — both AND together via `combineFilter`).

## Chip data model → query string

```ts
type Chip =
  | { kind: 'text'; text: string }                       // full-text (FTS)
  | { kind: 'field'; field: string; op: Op; value: string }
  | { kind: 'exists'; field: string; present: boolean }  // Has(x) / @Exception <> null
```

`compileChips(chips)` → joins each chip's fragment with ` and `:

- `text` → bare FTS literal: `'timeout'` (single quotes doubled). Searches
  message + exception via the FTS index.
- `field` → `` `${field} ${opToken(op)} ${quoteValue(value)}` ``.
- `exists` → structured: `Has(Field)` / (present:false handled only via the
  editor's "is not set", which for structured props is not expressible without
  `not`, so "is not set" is offered **only for @Exception** → `@Exception = null`).
  @Exception "is set" → `@Exception <> null`.

`quoteValue(v)`: numeric-looking (`/^-?\d+(\.\d+)?$/`) → raw number; otherwise
`'…'` with `'`→`''`. `// ponytail: string "42" on a text property emits a number;
acceptable default, user can Edit as query for the rare exception.`

### Operators (friendly label → token), hiding `%`

| Field type | Options |
|---|---|
| Message | **contains** → `text` chip (bare FTS) |
| Level (`@Level`) | is `=`, is not `<>` — value from the fixed 6 levels |
| Exception (`@Exception`) | is set `<> null`, is not set `= null` |
| Structured property | is `=`, is not `<>`, contains `contains 'v'`, starts with `like 'v%'`, ends with `like '%v'`, > `>`, < `<`, ≥ `>=`, ≤ `<=`, is set `Has(x)` |

`starts with` / `ends with` compile the `%` for the user, so no wildcard syntax
leaks into the value. `// ponytail: like does not escape a literal % in the
user value; values come from suggestions in practice — note, don't gold-plate.`

## Editor popover (`FilterEditor`)

Three-step, reuses `/api/search/suggest` via the existing `suggest()` client:

1. **Field** — a short built-in list (Message, Level, Exception) + structured
   field names from `suggest({ prefix })`, filtered as you type.
2. **Operator** — the row from the table above for the chosen field.
3. **Value** — for Level, the fixed list; for a structured field, a combobox
   backed by `suggest({ property, prefix })` plus free typing; for Message, free
   text; for Exception/"is set", skipped.

Confirming emits a `Chip`. Editing passes the existing chip in as initial state.
Same token conventions and popover styling as `ColumnPicker`/`TimeRangePicker`
(`bg-surface-raised border-border shadow-card rounded-card`, `Button`, `Input`).

## Parser — `parseChips(text): Chip[] | null`

The inverse of `compileChips`, scoped to exactly the grammar the builder emits.
Split the string at top-level ` and ` (ignoring `and` inside quotes/parens). If
any top-level `or`, `not`, or `(` appears, or any token doesn't match below,
return `null` (→ raw mode). Per token, in order:

- `^'(.*)'$` → `text` chip (unescape `''`).
- `^@Exception\s*(<>|=)\s*null$` → `exists` (`<>`→set, `=`→not set).
- `^Has\(\s*(\w+)\s*\)$` → `exists` structured, present true.
- `^(@?\w+)\s*(=|<>|<=|>=|<|>|like|contains)\s*(.+)$` → `field` chip. Value:
  `'…'` → unescape; else raw. Reverse-map `like 'v%'`→starts with,
  `like '%v'`→ends with, other `like` → `null` (bail). `=`→is, `<>`→is not, etc.

Used for `Edit as query` round-trip **and** for an incoming `initialFilter`
(deep link `?filter=` / a signal opened into search): parses to chips when it
can, else opens in raw mode showing that string.

This is the one non-trivial unit and gets a test.

## Integration

- `frontend/src/pages/EventsPage.tsx:169` — swap `<SearchBar … />` for
  `<FilterBar initialText={initialFilter} onCommit={setSearchText} />`. Nothing
  else in the page changes (`combineFilter`, levels, signals, export, live tail,
  `onClear` all keep working on the committed string).
- `FilterBar` renders the existing `SearchBar` for raw mode, so its
  autocomplete/history/validation are reused, not rebuilt.

## Files

- **New** `frontend/src/lib/filterChips.ts` — `Chip`, operator tables,
  `compileChips`, `parseChips`, `quoteValue` (pure, no React).
- **New** `frontend/src/lib/filterChips.test.ts` — round-trip + fallback tests.
- **New** `frontend/src/components/FilterEditor.tsx` — the field→op→value popover.
- **New** `frontend/src/components/FilterBar.tsx` — chips + add/edit + raw-mode toggle.
- **Modify** `frontend/src/pages/EventsPage.tsx` — one-line component swap.
- **Modify** `frontend/package.json` — add `vitest` (devDep) + `"test": "vitest run"`.
  `// documented as the frontend test tool in CLAUDE.md but not yet installed.`

## Testing & verification

- `npm run test` (new) — `filterChips.test.ts`: every chip shape round-trips
  (`parseChips(compileChips([c]))` ≡ `[c]`); `(a or b)`, `not x`, `a like
  '%mid%'` → `null`; quoting of embedded `'` and numeric vs string values.
- `npm run lint` and `npm run build` pass.
- Manual on `:5000`: add each chip type, edit a chip's value, remove chips,
  Edit as query and back, load a `?filter=` deep link — in both themes.
