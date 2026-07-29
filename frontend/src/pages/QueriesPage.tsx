import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { QueryOverview } from '../types'
import { getEvents } from '../api/events'
import { useQueries } from '../hooks/useStats'
import { PageIcon } from '../components/icons'
import { LevelBadge } from '../components/LevelBadge'
import { LiveRangeControls } from '../components/LiveRangeControls'
import { useLiveRange } from '../hooks/useLiveRange'
import { Sparkline } from '../components/Sparkline'
import { SqlText } from '../components/SqlText'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { formatTimestamp } from '../lib/dates'
import { formatDuration } from '../lib/duration'
import { quote } from '../lib/filter'
import { LEVEL_HEX } from '../lib/levels'
import { useI18n } from '../i18n'

const ROW_LIMIT = 50

const TH_CLASS = 'px-3 py-2 text-left text-xs font-medium text-fg-muted'
const TD_CLASS = 'px-3 py-2 text-sm text-fg'

type SortKey = 'calls' | 'total' | 'avg' | 'p95'

/** How much of a query the list shows. One line fits more rows on screen; three is enough to
 *  tell two statements on the same table apart, which one line often is not. */
type QueryLines = '1' | '3' | 'all'

const QUERY_LINES_KEY = 'logharbor-query-lines'

const CLAMP_CLASS: Record<QueryLines, string> = {
  '1': 'truncate',
  '3': 'line-clamp-3 break-words',
  all: 'break-words',
}

function sortValue(row: QueryOverview, key: SortKey): number {
  if (key === 'calls') return row.calls
  if (key === 'total') return row.totalMs ?? -1
  if (key === 'avg') return row.avgMs ?? -1
  return row.p95Ms ?? -1
}

export function QueriesPage() {
  const { t, lang } = useI18n()
  const { live, range, toggleLive, setRange } = useLiveRange()
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [selectedValue, setSelectedValue] = useState<string | null>(null)
  const [property, setProperty] = useState('commandText')
  const [durationProperty, setDurationProperty] = useState('elapsed')
  const [queryLines, setQueryLines] = useLocalStorage<QueryLines>(QUERY_LINES_KEY, '3')

  const queries = useQueries({ ...range, property, durationProperty, limit: ROW_LIMIT })
  const rows = [...(queries.data?.queries ?? [])].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey))
  // master-detail: something is always selected once rows exist
  const selected = rows.find((row) => row.value === selectedValue) ?? rows[0] ?? null

  const selectedFilter = selected ? `${property} = ${quote(selected.value)}` : ''
  const occurrences = useQuery({
    queryKey: ['query-occurrences', property, selected?.value, range],
    queryFn: () => getEvents({ filter: selectedFilter, from: range.from, to: range.to, count: 5 }),
    enabled: selected !== null,
  })

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
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <PageIcon name="queries" className="size-5" />
          {t.queries.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.queries.queryProperty}
            <Input
              aria-label={t.queries.queryProperty}
              value={property}
              onChange={(event) => setProperty(event.target.value)}
              className="w-36 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.queries.durationProperty}
            <Input
              aria-label={t.queries.durationProperty}
              value={durationProperty}
              onChange={(event) => setDurationProperty(event.target.value)}
              className="w-28 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t.queries.queryLines}
            <Select
              aria-label={t.queries.queryLines}
              value={queryLines}
              onChange={(event) => setQueryLines(event.target.value as QueryLines)}
              className="px-2 py-1 text-xs"
            >
              <option value="1">{t.queries.linesOne}</option>
              <option value="3">{t.queries.linesThree}</option>
              <option value="all">{t.queries.linesAll}</option>
            </Select>
          </label>
          <LiveRangeControls
            live={live}
            onToggleLive={toggleLive}
            from={range.from}
            to={range.to}
            onRangeChange={setRange}
          />
        </div>
      </div>

      {queries.error && <p className="bg-level-error/10 p-2 text-sm text-level-error">{queries.error.message}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-0 overflow-auto lg:w-1/2">
          <table className="w-full">
            <thead className="sticky top-0 border-b border-border bg-surface">
              <tr>
                <th className={TH_CLASS}>{t.queries.query}</th>
                {sortableHeader('calls', t.queries.calls)}
                {sortableHeader('total', t.queries.total)}
                {sortableHeader('avg', t.queries.avg)}
                {sortableHeader('p95', t.queries.p95)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.value}
                  onClick={() => setSelectedValue(row.value)}
                  className={`cursor-pointer border-b border-border last:border-b-0 ${
                    selected?.value === row.value ? 'bg-surface-raised' : 'hover:bg-surface-hover'
                  }`}
                >
                  <td
                    className={`${TD_CLASS} align-top font-mono ${queryLines === '1' ? 'max-w-0' : ''}`}
                    title={row.value}
                  >
                    <div className={CLAMP_CLASS[queryLines]}>
                      <SqlText text={row.value} />
                    </div>
                  </td>
                  <td className={`${TD_CLASS} tabular align-top text-right whitespace-nowrap`}>
                    {row.calls.toLocaleString(lang)}
                  </td>
                  <td className={`${TD_CLASS} tabular align-top text-right whitespace-nowrap`}>
                    {formatDuration(row.totalMs, lang)}
                  </td>
                  <td className={`${TD_CLASS} tabular align-top text-right whitespace-nowrap`}>
                    {formatDuration(row.avgMs, lang)}
                  </td>
                  <td className={`${TD_CLASS} tabular align-top text-right whitespace-nowrap`}>
                    {formatDuration(row.p95Ms, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queries.data && rows.length === 0 && (
            <div className="p-4">
              <p className="text-sm text-fg">{t.queries.noQueries}</p>
              <p className="mt-2 text-sm text-fg-muted">{t.queries.noQueriesHint}</p>
            </div>
          )}
        </Card>

        <Card className="min-h-0 overflow-y-auto p-4 lg:w-1/2">
          {selected && (
            <div className="flex flex-col gap-4">
              <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-inset p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg">
                <SqlText text={selected.value} />
              </pre>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <DetailTile label={t.queries.calls} value={selected.calls.toLocaleString(lang)} />
                <DetailTile label={t.queries.total} value={formatDuration(selected.totalMs, lang)} />
                <DetailTile label={t.queries.avg} value={formatDuration(selected.avgMs, lang)} />
                <DetailTile label={t.queries.p95} value={formatDuration(selected.p95Ms, lang)} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-fg-muted">{t.queries.connection}</dt>
                <dd className="text-right font-mono text-fg">{selected.connection ?? '—'}</dd>
                <dt className="text-fg-muted">{t.queries.lastSeen}</dt>
                <dd className="text-right text-fg">{formatTimestamp(selected.lastSeen, lang)}</dd>
                {selected.errorCount > 0 && (
                  <>
                    <dt className="text-fg-muted">{t.queries.errors}</dt>
                    <dd className="text-right font-medium text-level-error">
                      {selected.errorCount.toLocaleString(lang)}
                    </dd>
                  </>
                )}
              </dl>
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">
                    {t.queries.recentOccurrences}
                  </p>
                  <Link
                    to={`/events?${new URLSearchParams({ from: range.from, to: range.to, filter: selectedFilter }).toString()}`}
                    className="text-xs text-fg-muted transition-colors hover:text-accent"
                  >
                    {t.queries.openInEvents} →
                  </Link>
                </div>
                <div className="mt-2">
                  <Sparkline filter={selectedFilter} color={LEVEL_HEX.Information} from={range.from} to={range.to} />
                </div>
                <ul className="mt-2">
                  {(occurrences.data?.events ?? []).map((event) => {
                    const props = event.properties ? (JSON.parse(event.properties) as Record<string, unknown>) : {}
                    const elapsed = props[durationProperty]
                    return (
                      <li
                        key={event.id}
                        className="flex items-baseline gap-2 border-b border-border px-1 py-1 text-sm last:border-b-0"
                      >
                        <span className="whitespace-nowrap text-xs text-fg-muted">
                          {formatTimestamp(event.timestamp, lang)}
                        </span>
                        <LevelBadge level={event.level} />
                        <span className="ml-auto tabular text-fg-muted">
                          {typeof elapsed === 'number' ? `${Math.round(elapsed).toLocaleString(lang)} ms` : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="tabular text-lg font-semibold text-fg">{value}</p>
    </div>
  )
}
