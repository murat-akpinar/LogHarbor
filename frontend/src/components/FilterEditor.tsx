import { useEffect, useState } from 'react'
import { suggest } from '../api/events'
import { LEVELS } from '../lib/levels'
import { FIELD_OP_LABELS, LEVEL_OPS, STRING_OPS, type Chip, type FieldOp } from '../lib/filterChips'
import { useI18n } from '../i18n'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const POPOVER =
  'absolute left-0 top-full z-20 mt-1 w-72 rounded-card border border-border bg-surface-raised p-2 text-sm shadow-card'
const ROW =
  'block w-full rounded-lg px-2 py-1.5 text-left text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg'

interface FilterEditorProps {
  initial?: Chip
  onSubmit: (chip: Chip) => void
  onCancel: () => void
}

export function FilterEditor({ initial, onSubmit, onCancel }: FilterEditorProps) {
  const { t } = useI18n()
  const builtins: { field: string; label: string }[] = [
    { field: 'Message', label: t.filters.messageText },
    { field: '@Level', label: t.filters.level },
    { field: '@Exception', label: t.filters.exception },
  ]
  const [field, setField] = useState<string | null>(initial ? initialField(initial) : null)
  const [fieldQuery, setFieldQuery] = useState('')
  const [fieldNames, setFieldNames] = useState<string[]>([])
  const [op, setOp] = useState<FieldOp>(initial && initial.kind === 'field' ? initial.op : 'is')
  const [value, setValue] = useState(
    initial && initial.kind === 'field' ? initial.value : initial && initial.kind === 'text' ? initial.text : '',
  )
  const [values, setValues] = useState<string[]>([])

  const structured = field !== null && !isBuiltin(field)

  useEffect(() => {
    if (field !== null) return
    let live = true
    suggest({ prefix: fieldQuery })
      .then((r) => live && setFieldNames(r.suggestions))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [field, fieldQuery])

  useEffect(() => {
    if (!structured || field === null) return
    let live = true
    suggest({ property: field, prefix: value })
      .then((r) => live && setValues(r.suggestions))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [structured, field, value])

  // STEP 1 — choose the field
  if (field === null) {
    const q = fieldQuery.toLowerCase()
    return (
      <div className={POPOVER}>
        <Input
          autoFocus
          mono
          placeholder={t.filters.fieldPlaceholder}
          value={fieldQuery}
          onChange={(e) => setFieldQuery(e.target.value)}
          className="mb-2 w-full"
        />
        {builtins.filter((b) => b.label.toLowerCase().includes(q)).map((b) => (
          <button key={b.field} type="button" className={ROW} onClick={() => setField(b.field)}>
            {b.label}
          </button>
        ))}
        {fieldNames.map((name) => (
          <button key={name} type="button" className={`${ROW} font-mono`} onClick={() => setField(name)}>
            {name}
          </button>
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
        <Header label={t.filters.messageContains} onBack={() => setField(null)} />
        <Input
          autoFocus
          mono
          placeholder={t.filters.textPlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          className="mb-2 w-full"
        />
        <Actions onCancel={onCancel} onSubmit={submit} disabled={!value.trim()} />
      </div>
    )
  }

  // Exception → is set / is not set
  if (field === '@Exception') {
    return (
      <div className={POPOVER}>
        <Header label={t.filters.exception} onBack={() => setField(null)} />
        <button
          type="button"
          className={ROW}
          onClick={() => onSubmit({ kind: 'exists', field: '@Exception', present: true })}
        >
          is set
        </button>
        <button
          type="button"
          className={ROW}
          onClick={() => onSubmit({ kind: 'exists', field: '@Exception', present: false })}
        >
          is not set
        </button>
        <Footer onCancel={onCancel} />
      </div>
    )
  }

  const ops = field === '@Level' ? LEVEL_OPS : STRING_OPS
  const submitField = () => value.trim() && onSubmit({ kind: 'field', field, op, value: value.trim() })

  // @Level and structured properties → operator + value
  return (
    <div className={POPOVER}>
      <Header label={field === '@Level' ? t.filters.level : field} onBack={() => setField(null)} />
      <div className="mb-2 flex flex-wrap gap-1">
        {ops.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setOp(candidate)}
            className={`rounded-lg px-2 py-1 text-xs transition-colors duration-150 ${
              op === candidate
                ? 'border border-accent/30 bg-accent/15 text-accent'
                : 'text-fg-muted hover:bg-surface-hover'
            }`}
          >
            {FIELD_OP_LABELS[candidate]}
          </button>
        ))}
        {structured && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover"
            onClick={() => onSubmit({ kind: 'exists', field, present: true })}
          >
            is set
          </button>
        )}
      </div>
      {field === '@Level' ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onSubmit({ kind: 'field', field, op, value: level })}
              className="rounded-lg border border-border-strong px-2 py-1 text-xs text-fg hover:bg-surface-hover"
            >
              {level}
            </button>
          ))}
        </div>
      ) : (
        <>
          <Input
            autoFocus
            mono
            placeholder={t.filters.valuePlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitField()
            }}
            className="mb-1 w-full"
            list="filter-value-suggestions"
          />
          <datalist id="filter-value-suggestions">
            {values.map((v) => (
              <option key={v} value={v} />
            ))}
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
  const { t } = useI18n()
  return (
    <div className="mb-2 flex items-center gap-2">
      <button type="button" onClick={onBack} className="text-fg-muted hover:text-fg" aria-label={t.common.back}>
        ←
      </button>
      <span className="truncate font-mono text-xs text-fg">{label}</span>
    </div>
  )
}

function Footer({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n()
  return (
    <div className="mt-1 flex justify-end border-t border-border pt-1">
      <Button variant="ghost" onClick={onCancel}>
        {t.common.cancel}
      </Button>
    </div>
  )
}

function Actions({ onCancel, onSubmit, disabled }: { onCancel: () => void; onSubmit: () => void; disabled: boolean }) {
  const { t } = useI18n()
  return (
    <div className="mt-1 flex justify-end gap-1">
      <Button variant="ghost" onClick={onCancel}>
        {t.common.cancel}
      </Button>
      <Button variant="primary" onClick={onSubmit} disabled={disabled}>
        {t.common.add}
      </Button>
    </div>
  )
}
