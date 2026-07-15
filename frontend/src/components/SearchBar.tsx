import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { suggest, validateFilter } from '../api/events'
import { getSuggestContext } from '../lib/suggestContext'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { Input } from './ui/Input'

const SUGGEST_DEBOUNCE_MS = 150
const HISTORY_MAX = 10

interface SearchBarProps {
  initialText?: string
  onCommit: (filter: string) => void
}

export function SearchBar({ initialText = '', onCommit }: SearchBarProps) {
  const [text, setText] = useState(initialText)
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [history, setHistory] = useLocalStorage<string[]>('logharbor.searchHistory', [])
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const contextRef = useRef<ReturnType<typeof getSuggestContext>>(null)

  // history entries were valid when saved, so committing one skips re-validation
  function commitValid(filter: string) {
    setHistory((current) => [filter, ...current.filter((entry) => entry !== filter)].slice(0, HISTORY_MAX))
    setError(null)
    onCommit(filter)
  }

  useEffect(() => {
    const cursor = inputRef.current?.selectionStart ?? text.length
    const context = getSuggestContext(text, cursor)
    contextRef.current = context
    if (!context) {
      setSuggestions([])
      return
    }
    const handle = setTimeout(() => {
      suggest(
        context.mode === 'value'
          ? { property: context.property, prefix: context.prefix }
          : { prefix: context.prefix },
      )
        .then((result) => setSuggestions(result.suggestions))
        .catch(() => setSuggestions([]))
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [text])

  useEffect(() => setHighlightIndex(0), [suggestions])

  function applySuggestion(value: string) {
    const context = contextRef.current
    const input = inputRef.current
    if (!context || !input) return
    const cursor = input.selectionStart ?? text.length
    const suffix = context.mode === 'value' ? "'" : ''
    const next = text.slice(0, context.replaceFrom) + value + suffix + text.slice(cursor)
    setText(next)
    setSuggestions([])
    const caret = context.replaceFrom + value.length + suffix.length
    requestAnimationFrame(() => input.setSelectionRange(caret, caret))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      applySuggestion(suggestions[highlightIndex])
    } else if (event.key === 'Escape') {
      setSuggestions([])
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) {
      setError(null)
      onCommit('')
      return
    }

    setIsValidating(true)
    try {
      const result = await validateFilter(trimmed)
      if (result.valid) {
        commitValid(trimmed)
      } else {
        setError(result.position !== undefined ? `${result.error} (position ${result.position})` : (result.error ?? 'Invalid filter'))
      }
    } catch {
      setError('Could not validate filter; check your connection.')
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <Input
        ref={inputRef}
        id="event-search"
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() =>
          setTimeout(() => {
            setSuggestions([])
            setIsFocused(false)
          }, 100)
        }
        placeholder="@Level = 'Error' and RequestPath like '/api/%'"
        mono
        className="w-full"
        disabled={isValidating}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-autocomplete="list"
      />
      {suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface-raised text-sm shadow-card">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion}>
              <button
                type="button"
                // onMouseDown (not onClick) fires before the input's onBlur closes the list
                onMouseDown={(event) => {
                  event.preventDefault()
                  applySuggestion(suggestion)
                }}
                className={`block w-full truncate px-3 py-1.5 text-left font-mono ${
                  index === highlightIndex ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'
                }`}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
      {isFocused && text.trim() === '' && history.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface-raised text-sm shadow-card">
          {history.map((entry) => (
            <li key={entry}>
              <button
                type="button"
                // onMouseDown (not onClick) fires before the input's onBlur closes the list
                onMouseDown={(event) => {
                  event.preventDefault()
                  setText(entry)
                  commitValid(entry)
                }}
                className="block w-full truncate px-3 py-1.5 text-left font-mono text-fg-muted hover:bg-surface-hover"
              >
                {entry}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-level-error">{error}</p>}
    </form>
  )
}
