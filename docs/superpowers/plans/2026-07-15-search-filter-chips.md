# Search Filter Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw query search box on the Events page with a Kibana-style filter-chip builder (field → operator → value, no syntax), keeping the existing raw box as an "edit as query" escape hatch.

**Architecture:** A pure `filterChips.ts` module compiles a `Chip[]` to a Seyir query string and parses a string back to chips (bailing to raw mode on anything it didn't emit). A `FilterEditor` popover builds one chip using the existing `/api/search/suggest` endpoint. A `FilterBar` owns the chip list, renders the existing `SearchBar` for raw mode, and keeps the `{ initialText, onCommit }` contract so `EventsPage` changes by one line. No backend change.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind v4, oxlint. Adds **Vitest** (dev dependency) as the frontend test runner for the pure module.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-15-search-filter-chips-design.md`. Read before Task 1.
- **No backend changes.** `/api/search/suggest`, the query parser, and `combineFilter` are out of bounds.
- **AND-only in chips.** OR / NOT / parentheses are not built in the UI; they arrive only through "edit as query" and keep the filter in raw mode.
- **Query language (verbatim from `docs/query-language.md`):** ops `= <> < <= > >= like contains`; built-ins `@Level @Message @Timestamp @Exception @MessageTemplate`; bare identifiers are structured properties; `Has(Ident)` existence; a bare `'quoted'` string is full-text (FTS); string literals double an embedded quote (`'O''Brien'`); `null` works only with `=` / `<>`.
- **Design tokens only** (from `frontend/src/index.css`): no raw palette classes. Reuse `Button`, `Input`, and the `ColumnPicker` popover shape (`bg-surface-raised border-border shadow-card rounded-card`).
- **Verification per task:** `npm run lint` and `npm run build` pass from `frontend/`; Task 1 also runs `npm run test`. The user is not using git remotes yet — **do not push**; commit locally only if asked (the executing worker may skip commits and the steps below still hold).

---

### Task 1: `filterChips` module + Vitest (pure logic, TDD)

The core. Compiles chips to a query string and parses the string back. Pure, no React, fully testable.

**Files:**
- Modify: `frontend/package.json` (add `vitest` devDep + `test` script)
- Create: `frontend/src/lib/filterChips.ts`
- Test: `frontend/src/lib/filterChips.test.ts`

**Interfaces:**
- Consumes: `LEVELS` from `frontend/src/lib/levels.ts`.
- Produces:
  - `type Chip = { kind:'text'; text:string } | { kind:'field'; field:string; op:FieldOp; value:string } | { kind:'exists'; field:string; present:boolean }`
  - `type FieldOp = 'is'|'is-not'|'contains'|'starts-with'|'ends-with'|'gt'|'lt'|'gte'|'lte'`
  - `FIELD_OP_LABELS: Record<FieldOp,string>`, `LEVEL_OPS: FieldOp[]`, `STRING_OPS: FieldOp[]`
  - `compileChips(chips: Chip[]): string`
  - `parseChips(text: string): Chip[] | null`  (`null` = show raw mode)
  - `chipLabel(chip: Chip): string`

- [ ] **Step 1: Install Vitest and add the test script**

From `frontend/`:

```bash
npm install -D vitest
```

Then in `frontend/package.json`, add to `"scripts"` (Vitest is zero-config for this — no `vitest.config` file needed):

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/lib/filterChips.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chipLabel, compileChips, parseChips, type Chip } from './filterChips'

const ROUND_TRIP: Chip[][] = [
  [{ kind: 'text', text: 'timeout' }],
  [{ kind: 'field', field: '@Level', op: 'is', value: 'Error' }],
  [{ kind: 'field', field: '@Level', op: 'is-not', value: 'Information' }],
  [{ kind: 'field', field: 'RequestPath', op: 'starts-with', value: '/api/' }],
  [{ kind: 'field', field: 'RequestPath', op: 'ends-with', value: '.json' }],
  [{ kind: 'field', field: 'User', op: 'contains', value: "O'Brien" }],
  [{ kind: 'field', field: 'StatusCode', op: 'gte', value: '500' }],
  [{ kind: 'field', field: 'Elapsed', op: 'lt', value: '10' }],
  [{ kind: 'exists', field: '@Exception', present: true }],
  [{ kind: 'exists', field: '@Exception', present: false }],
  [{ kind: 'exists', field: 'OrderId', present: true }],
  [
    { kind: 'text', text: 'timeout' },
    { kind: 'field', field: '@Level', op: 'is', value: 'Error' },
  ],
]

describe('compileChips / parseChips round-trip', () => {
  for (const chips of ROUND_TRIP) {
    it(compileChips(chips) || '(empty)', () => {
      expect(parseChips(compileChips(chips))).toEqual(chips)
    })
  }
  it('empty list compiles to empty string and parses to []', () => {
    expect(compileChips([])).toBe('')
    expect(parseChips('')).toEqual([])
  })
})

describe('parseChips bails to raw (null) on anything the builder never emits', () => {
  for (const text of [
    '(A = 1 or B = 2)',
    'A = 1 or B = 2',
    'not X = 1',
    "P like '%middle%'",
    'garbage tokens here',
  ]) {
    it(text, () => expect(parseChips(text)).toBeNull())
  }
})

describe('quoting', () => {
  it('doubles an embedded quote in a text chip', () => {
    expect(compileChips([{ kind: 'text', text: "O'Brien" }])).toBe("'O''Brien'")
  })
  it('keeps a numeric value unquoted', () => {
    expect(compileChips([{ kind: 'field', field: 'N', op: 'is', value: '42' }])).toBe('N = 42')
  })
  it('quotes a non-numeric value', () => {
    expect(compileChips([{ kind: 'field', field: 'S', op: 'is', value: 'x' }])).toBe("S = 'x'")
  })
})

describe('chipLabel', () => {
  it('drops the @ and reads naturally', () => {
    expect(chipLabel({ kind: 'field', field: '@Level', op: 'is', value: 'Error' })).toBe('Level is Error')
    expect(chipLabel({ kind: 'exists', field: '@Exception', present: false })).toBe('Exception is not set')
    expect(chipLabel({ kind: 'text', text: 'timeout' })).toBe('"timeout"')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run test
```

Expected: FAIL — `filterChips.ts` does not exist / exports missing.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/lib/filterChips.ts`:

```ts
import { LEVELS } from './levels'

export type FieldOp =
  | 'is' | 'is-not' | 'contains' | 'starts-with' | 'ends-with'
  | 'gt' | 'lt' | 'gte' | 'lte'

export type Chip =
  | { kind: 'text'; text: string }
  | { kind: 'field'; field: string; op: FieldOp; value: string }
  | { kind: 'exists'; field: string; present: boolean }

export const FIELD_OP_LABELS: Record<FieldOp, string> = {
  is: 'is',
  'is-not': 'is not',
  contains: 'contains',
  'starts-with': 'starts with',
  'ends-with': 'ends with',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
}

export const LEVEL_OPS: FieldOp[] = ['is', 'is-not']
export const STRING_OPS: FieldOp[] = ['is', 'is-not', 'contains', 'starts-with', 'ends-with', 'gt', 'lt', 'gte', 'lte']

const NUMERIC = /^-?\d+(\.\d+)?$/

// single-quote wrap with the query language's '' escaping
function sq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// = / <> / comparisons keep a numeric literal raw so numeric properties compare as numbers
function quoteScalar(value: string): string {
  return NUMERIC.test(value) ? value : sq(value)
}

function short(field: string): string {
  return field.startsWith('@') ? field.slice(1) : field
}

export function compileChips(chips: Chip[]): string {
  return chips.map(compileChip).join(' and ')
}

function compileChip(chip: Chip): string {
  if (chip.kind === 'text') return sq(chip.text)
  if (chip.kind === 'exists') {
    if (chip.field === '@Exception') return chip.present ? '@Exception <> null' : '@Exception = null'
    // present:false for a structured field would need `not Has(...)`, which the editor does not offer
    return `Has(${chip.field})`
  }
  const { field, op, value } = chip
  switch (op) {
    case 'is': return `${field} = ${quoteScalar(value)}`
    case 'is-not': return `${field} <> ${quoteScalar(value)}`
    case 'contains': return `${field} contains ${sq(value)}`
    // ponytail: starts/ends-with build the % for the user; a literal % in value is not escaped
    //           (values come from suggestions in practice) — note, don't gold-plate.
    case 'starts-with': return `${field} like ${sq(value + '%')}`
    case 'ends-with': return `${field} like ${sq('%' + value)}`
    case 'gt': return `${field} > ${quoteScalar(value)}`
    case 'lt': return `${field} < ${quoteScalar(value)}`
    case 'gte': return `${field} >= ${quoteScalar(value)}`
    case 'lte': return `${field} <= ${quoteScalar(value)}`
  }
}

export function chipLabel(chip: Chip): string {
  if (chip.kind === 'text') return `"${chip.text}"`
  if (chip.kind === 'exists') return `${short(chip.field)} ${chip.present ? 'is set' : 'is not set'}`
  return `${short(chip.field)} ${FIELD_OP_LABELS[chip.op]} ${chip.value}`
}

// --- parsing: the strict inverse of compileChips; anything else returns null (raw mode) ---

const IDENT = '@?[A-Za-z_][A-Za-z0-9_]*'
const PLACEHOLDER = ' '

export function parseChips(text: string): Chip[] | null {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = splitTopLevelAnd(trimmed)
  if (!parts) return null
  const chips: Chip[] = []
  for (const part of parts) {
    const chip = parsePart(part.trim())
    if (!chip) return null
    chips.push(chip)
  }
  return chips
}

// mask quoted literals and Has(...) calls, then reject grouping/OR/leading-NOT, then split on ` and `
function splitTopLevelAnd(text: string): string[] | null {
  const masked: string[] = []
  const hide = (m: string) => {
    masked.push(m)
    return `${PLACEHOLDER}${masked.length - 1}${PLACEHOLDER}`
  }
  let s = text.replace(/'(?:[^']|'')*'/g, hide)
  s = s.replace(new RegExp(`Has\\(\\s*${IDENT}\\s*\\)`, 'gi'), hide)
  if (s.includes('(') || s.includes(')')) return null
  if (/\bor\b/i.test(s)) return null
  if (/^\s*not\b/i.test(s)) return null
  const unmask = (p: string) => p.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, i) => masked[Number(i)])
  return s.split(/\s+and\s+/i).map(unmask)
}

function parsePart(part: string): Chip | null {
  const fts = /^'((?:[^']|'')*)'$/.exec(part)
  if (fts) return { kind: 'text', text: fts[1].replace(/''/g, "'") }

  const exc = /^@Exception\s*(<>|=)\s*null$/i.exec(part)
  if (exc) return { kind: 'exists', field: '@Exception', present: exc[1] === '<>' }

  const has = new RegExp(`^Has\\(\\s*(${IDENT})\\s*\\)$`, 'i').exec(part)
  if (has) return { kind: 'exists', field: has[1], present: true }

  const cmp = new RegExp(`^(${IDENT})\\s*(<>|<=|>=|=|<|>|like|contains)\\s*(.+)$`, 'i').exec(part)
  if (cmp) {
    const field = cmp[1]
    const token = cmp[2].toLowerCase()
    const parsed = reverseOp(token, cmp[3].trim())
    if (!parsed) return null
    return { kind: 'field', field, op: parsed.op, value: parsed.value }
  }
  return null
}

// bare token or quoted string -> its logical value; returns null for `null` (only valid via @Exception path)
function readValue(raw: string): { value: string; quoted: boolean } | null {
  const q = /^'((?:[^']|'')*)'$/.exec(raw)
  if (q) return { value: q[1].replace(/''/g, "'"), quoted: true }
  if (raw.toLowerCase() === 'null') return null
  return { value: raw, quoted: false }
}

function reverseOp(token: string, raw: string): { op: FieldOp; value: string } | null {
  const v = readValue(raw)
  if (!v) return null
  switch (token) {
    case '=': return { op: 'is', value: v.value }
    case '<>': return { op: 'is-not', value: v.value }
    case '>': return { op: 'gt', value: v.value }
    case '<': return { op: 'lt', value: v.value }
    case '>=': return { op: 'gte', value: v.value }
    case '<=': return { op: 'lte', value: v.value }
    case 'contains':
      return v.quoted ? { op: 'contains', value: v.value } : null
    case 'like': {
      if (!v.quoted) return null
      const p = v.value
      const startsPct = p.startsWith('%')
      const endsPct = p.endsWith('%')
      if (endsPct && !startsPct) return { op: 'starts-with', value: p.slice(0, -1) }
      if (startsPct && !endsPct) return { op: 'ends-with', value: p.slice(1) }
      return null // a %middle% or bare pattern is not representable as a chip
    }
  }
  return null
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test
```

Expected: PASS (all round-trip, bail, quoting and label tests green).

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run build
git add frontend/package.json frontend/package-lock.json frontend/src/lib/filterChips.ts frontend/src/lib/filterChips.test.ts
git commit -m "feat(search): filterChips compile/parse module with tests"
```

---

### Task 2: `FilterEditor` popover (field → operator → value)

Builds one chip. Reuses `/api/search/suggest` through the existing `suggest()` client. No test runner for React components here — the gate is `tsc`/lint plus a manual render check.

**Files:**
- Create: `frontend/src/components/FilterEditor.tsx`

**Interfaces:**
- Consumes: `suggest` from `frontend/src/api/events.ts` (`suggest({ prefix })` → field names; `suggest({ property, prefix })` → values), `LEVELS` from `lib/levels.ts`, `STRING_OPS`/`LEVEL_OPS`/`FIELD_OP_LABELS`/`Chip`/`FieldOp` from `lib/filterChips.ts`, `Button`/`Input`.
- Produces: `<FilterEditor initial?: Chip; onSubmit: (chip: Chip) => void; onCancel: () => void />`.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/FilterEditor.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { suggest } from '../api/events'
import { LEVELS } from '../lib/levels'
import { FIELD_OP_LABELS, LEVEL_OPS, STRING_OPS, type Chip, type FieldOp } from '../lib/filterChips'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const BUILTINS: { field: string; label: string }[] = [
  { field: 'Message', label: 'Message text' },
  { field: '@Level', label: 'Level' },
  { field: '@Exception', label: 'Exception' },
]

const POPOVER = 'absolute left-0 top-full z-20 mt-1 w-72 rounded-card border border-border bg-surface-raised p-2 text-sm shadow-card'
const ROW = 'block w-full rounded-lg px-2 py-1.5 text-left text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg'

interface FilterEditorProps {
  initial?: Chip
  onSubmit: (chip: Chip) => void
  onCancel: () => void
}

export function FilterEditor({ initial, onSubmit, onCancel }: FilterEditorProps) {
  const [field, setField] = useState<string | null>(initial ? initialField(initial) : null)
  const [fieldQuery, setFieldQuery] = useState('')
  const [fieldNames, setFieldNames] = useState<string[]>([])
  const [op, setOp] = useState<FieldOp>(initial && initial.kind === 'field' ? initial.op : 'is')
  const [value, setValue] = useState(initial && initial.kind === 'field' ? initial.value : initial && initial.kind === 'text' ? initial.text : '')
  const [values, setValues] = useState<string[]>([])

  const structured = field !== null && !isBuiltin(field)

  useEffect(() => {
    if (field !== null) return
    let live = true
    suggest({ prefix: fieldQuery }).then((r) => live && setFieldNames(r.suggestions)).catch(() => {})
    return () => { live = false }
  }, [field, fieldQuery])

  useEffect(() => {
    if (!structured) return
    let live = true
    suggest({ property: field, prefix: value }).then((r) => live && setValues(r.suggestions)).catch(() => {})
    return () => { live = false }
  }, [structured, field, value])

  // STEP 1 — choose the field
  if (field === null) {
    const q = fieldQuery.toLowerCase()
    return (
      <div className={POPOVER}>
        <Input autoFocus mono placeholder="Field…" value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} className="mb-2 w-full" />
        {BUILTINS.filter((b) => b.label.toLowerCase().includes(q)).map((b) => (
          <button key={b.field} type="button" className={ROW} onClick={() => setField(b.field)}>{b.label}</button>
        ))}
        {fieldNames.map((name) => (
          <button key={name} type="button" className={`${ROW} font-mono`} onClick={() => setField(name)}>{name}</button>
        ))}
        <Footer onCancel={onCancel} />
      </div>
    )
  }

  // Message → plain full-text chip
  if (field === 'Message') {
    const submit = () => value.trim() && onSubmit({ kind: 'text', text: value.trim() })
    return (
      <div className={POPOVER}>
        <Header label="Message contains" onBack={() => setField(null)} />
        <Input autoFocus mono placeholder="text…" value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className="mb-2 w-full" />
        <Actions onCancel={onCancel} onSubmit={submit} disabled={!value.trim()} />
      </div>
    )
  }

  // Exception → is set / is not set
  if (field === '@Exception') {
    return (
      <div className={POPOVER}>
        <Header label="Exception" onBack={() => setField(null)} />
        <button type="button" className={ROW} onClick={() => onSubmit({ kind: 'exists', field: '@Exception', present: true })}>is set</button>
        <button type="button" className={ROW} onClick={() => onSubmit({ kind: 'exists', field: '@Exception', present: false })}>is not set</button>
        <Footer onCancel={onCancel} />
      </div>
    )
  }

  const ops = field === '@Level' ? LEVEL_OPS : STRING_OPS
  const submitField = () => value.trim() && onSubmit({ kind: 'field', field, op, value: value.trim() })

  // @Level and structured properties → operator + value
  return (
    <div className={POPOVER}>
      <Header label={field === '@Level' ? 'Level' : field} onBack={() => setField(null)} />
      <div className="mb-2 flex flex-wrap gap-1">
        {ops.map((candidate) => (
          <button key={candidate} type="button" onClick={() => setOp(candidate)}
            className={`rounded-lg px-2 py-1 text-xs transition-colors duration-150 ${op === candidate ? 'bg-accent/15 text-accent border border-accent/30' : 'text-fg-muted hover:bg-surface-hover'}`}>
            {FIELD_OP_LABELS[candidate]}
          </button>
        ))}
        {structured && (
          <>
            <button type="button" className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover" onClick={() => onSubmit({ kind: 'exists', field, present: true })}>is set</button>
          </>
        )}
      </div>
      {field === '@Level' ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {LEVELS.map((level) => (
            <button key={level} type="button" onClick={() => onSubmit({ kind: 'field', field, op, value: level })}
              className="rounded-lg border border-border-strong px-2 py-1 text-xs text-fg hover:bg-surface-hover">{level}</button>
          ))}
        </div>
      ) : (
        <>
          <Input autoFocus mono placeholder="value…" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitField() }} className="mb-1 w-full" list="filter-value-suggestions" />
          <datalist id="filter-value-suggestions">
            {values.map((v) => <option key={v} value={v} />)}
          </datalist>
          <Actions onCancel={onCancel} onSubmit={submitField} disabled={!value.trim()} />
        </>
      )}
    </div>
  )
}

function isBuiltin(field: string): boolean {
  return field === 'Message' || field === '@Level' || field === '@Exception'
}

function initialField(chip: Chip): string {
  if (chip.kind === 'text') return 'Message'
  return chip.field
}

function Header({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <button type="button" onClick={onBack} className="text-fg-muted hover:text-fg" aria-label="Back">←</button>
      <span className="truncate font-mono text-xs text-fg">{label}</span>
    </div>
  )
}

function Footer({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-1 flex justify-end border-t border-border pt-1">
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

function Actions({ onCancel, onSubmit, disabled }: { onCancel: () => void; onSubmit: () => void; disabled: boolean }) {
  return (
    <div className="mt-1 flex justify-end gap-1">
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSubmit} disabled={disabled}>Add</Button>
    </div>
  )
}
```

Note: the value combobox uses a native `<datalist>` (rung-3 native feature) instead of a hand-built suggestion list — the `suggest()` values fill it and the browser handles the dropdown.

- [ ] **Step 2: Verify**

```bash
npm run lint && npm run build
```

Expected: both pass (nothing imports `FilterEditor` yet, so no behaviour change).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FilterEditor.tsx
git commit -m "feat(search): FilterEditor field/operator/value popover"
```

---

### Task 3: `FilterBar` + wire into `EventsPage` (end-to-end)

Owns the chip list, renders the existing `SearchBar` for raw mode, and replaces `SearchBar` in the Events header.

**Files:**
- Create: `frontend/src/components/FilterBar.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx:169`

**Interfaces:**
- Consumes: `compileChips`/`parseChips`/`chipLabel`/`Chip` from `lib/filterChips.ts`, `FilterEditor` (Task 2), `SearchBar` from `components/SearchBar.tsx`, `Button`.
- Produces: `<FilterBar initialText?: string; onCommit: (filter: string) => void />` — same contract `SearchBar` had, so `EventsPage` state (`setSearchText`) is unchanged.

- [ ] **Step 1: Write `FilterBar`**

Create `frontend/src/components/FilterBar.tsx`:

```tsx
import { useState } from 'react'
import { chipLabel, compileChips, parseChips, type Chip } from '../lib/filterChips'
import { FilterEditor } from './FilterEditor'
import { SearchBar } from './SearchBar'
import { Button } from './ui/Button'

interface FilterBarProps {
  initialText?: string
  onCommit: (filter: string) => void
}

export function FilterBar({ initialText = '', onCommit }: FilterBarProps) {
  const parsed = parseChips(initialText)
  const [chips, setChips] = useState<Chip[]>(parsed ?? [])
  // non-null => raw mode (a filter too complex for chips); null => chip mode
  const [raw, setRaw] = useState<string | null>(parsed ? null : initialText)
  // null => closed; { index:null } => adding; { index:n } => editing chip n
  const [editing, setEditing] = useState<{ index: number | null } | null>(null)

  function commit(next: Chip[]) {
    setChips(next)
    onCommit(compileChips(next))
  }

  function upsert(chip: Chip) {
    if (editing && editing.index !== null) {
      const next = chips.slice()
      next[editing.index] = chip
      commit(next)
    } else {
      commit([...chips, chip])
    }
    setEditing(null)
  }

  if (raw !== null) {
    return (
      <div>
        <SearchBar
          initialText={raw}
          onCommit={(text) => {
            const back = parseChips(text)
            if (back) {
              setChips(back)
              setRaw(null)
              onCommit(compileChips(back))
            } else {
              setRaw(text)
              onCommit(text)
            }
          }}
        />
        <button type="button" className="mt-1 text-xs text-fg-muted underline hover:text-fg"
          onClick={() => { commit([]); setRaw(null) }}>
          Clear and use filters
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip, index) => (
        <span key={index} className="inline-flex items-center gap-1 rounded-lg border border-border-strong bg-surface-raised py-1 pr-1 pl-2 text-xs">
          <button type="button" className="font-mono text-fg hover:text-accent" onClick={() => setEditing({ index })}>
            {chipLabel(chip)}
          </button>
          <button type="button" aria-label="Remove filter" className="rounded px-1 text-fg-muted hover:text-fg"
            onClick={() => commit(chips.filter((_, i) => i !== index))}>✕</button>
        </span>
      ))}
      <div className="relative">
        <Button variant="secondary" onClick={() => setEditing((current) => (current ? null : { index: null }))}>
          + Add filter
        </Button>
        {editing && (
          <FilterEditor
            initial={editing.index !== null ? chips[editing.index] : undefined}
            onSubmit={upsert}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
      <button type="button" className="ml-auto text-xs text-fg-muted underline hover:text-fg"
        onClick={() => setRaw(compileChips(chips))}>
        Edit as query
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Swap `SearchBar` for `FilterBar` in `EventsPage`**

In `frontend/src/pages/EventsPage.tsx`, change the import (line ~13):

```tsx
import { FilterBar } from '../components/FilterBar'
```

(remove the now-unused `import { SearchBar } ...` line — `SearchBar` is still used, but only inside `FilterBar`, so `EventsPage` must not import it. Delete `EventsPage`'s `SearchBar` import.)

Then replace the header usage (line ~169):

```tsx
        <div className="p-3">
          <FilterBar initialText={initialFilter} onCommit={setSearchText} />
        </div>
```

- [ ] **Step 3: Verify build and types**

```bash
npm run lint && npm run build && npm run test
```

Expected: all pass. A "SearchBar is declared but never read" error means the old import in `EventsPage` was not removed — remove it.

- [ ] **Step 4: Manual end-to-end on port 5000**

The redesigned SPA is served from `backend/Seyir.Api/wwwroot`. Refresh it and restart the backend (from repo root, PowerShell):

```powershell
# rebuild SPA, copy into wwwroot, restart backend on :5000 (isolated verify DB)
npm --prefix frontend run build
Get-ChildItem -Force backend/Seyir.Api/wwwroot | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
Copy-Item -Recurse -Force frontend/dist/* backend/Seyir.Api/wwwroot
$env:Seyir__DatabasePath = "$env:TEMP\seyir-verify\seyir.db"
dotnet run --project backend/Seyir.Api --urls http://localhost:5000
```

Open http://localhost:5000, sign in (`admin`/`admin`, then set a password), seed a few events if empty, and confirm by hand in both themes:
- `+ Add filter` → pick `Level` → `is` → `Error`: an event query runs; chip reads `Level is Error`.
- `+ Add filter` → a structured field (e.g. `RequestPath`) → `starts with` → value from the datalist suggestions.
- Click a chip → the popover reopens pre-filled; change the value → the chip updates.
- `✕` removes a chip; removing all shows every event.
- `Edit as query` → the raw box shows the compiled string; type `A = 1 or B = 2`, submit → stays raw; `Clear and use filters` → back to empty chips.
- Reload with `?filter=@Level = 'Error'` in the URL → opens as a `Level is Error` chip (parsed back), not raw.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FilterBar.tsx frontend/src/pages/EventsPage.tsx
git commit -m "feat(search): chip-based FilterBar with edit-as-query, wired into Events"
```

---

## Notes for the implementer

- The only non-trivial logic is `filterChips.ts`; its test is the safety net. The UI is assembled from the existing token system, `Button`/`Input`, `suggest()`, and a native `<datalist>` — resist adding a suggestion-list widget or new dependencies.
- Keep `SearchBar` exactly as it is. `FilterBar` wraps it for raw mode; do not fork or edit it.
- `combineFilter` already AND-joins `searchText` with the level quick-toggles and signals, so a multi-chip `searchText` composes correctly — no change needed there.
- Do not push to any git remote; the user manages that.
```
