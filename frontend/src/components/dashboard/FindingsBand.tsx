import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Finding } from '../../types'
import { FINDING_COLOR, sparklineRange } from '../../lib/findings'
import { Panel } from '../ui/Panel'
import { Sparkline } from '../Sparkline'
import { useI18n } from '../../i18n'

interface FindingsBandProps {
  findings: Finding[]
  from: string
  to: string
}

/**
 * What the server noticed by itself, above the panels and below the alarm deck.
 *
 * Deliberately quiet. It does not glow, it does not pulse, and it never turns the page red — an
 * alarm is something a person decided was worth waking up for, and a finding is a guess. Giving
 * the two the same voice would spend the alarm's credibility on the guess. What it does earn is
 * position: a reader who never opens Analysis still walks past it.
 *
 * What it does instead of shouting is speak the dashboard's own language. Each row takes the hue
 * this page already draws that measurement in (lib/findings) and carries its own shape as a
 * sparkline over the same window — so a finding reads as one more chart among the charts rather
 * than as a paragraph pinned above them. The first version was a grey chip and a grey sentence,
 * and the owner walked straight past it on the live server.
 */
export function FindingsBand({ findings, from, to }: FindingsBandProps) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  function openEvents(finding: Finding) {
    navigate(`/events?${new URLSearchParams({ from, to, filter: finding.filter }).toString()}`)
  }

  /** The finding said as a sentence. Each kind measures something different, so each gets its
   *  own phrasing rather than a shared "x vs y" that means nothing without a unit. */
  function describe(finding: Finding): string {
    const n = (value: number) => value.toLocaleString(lang)
    switch (finding.kind) {
      case 'went_quiet':
        return t.findings.wentQuiet(finding.subject, n(finding.baseline))
      case 'new_exception':
        return t.findings.newException(finding.subject, n(finding.count))
      case 'failing_route':
        return t.findings.failingRoute(finding.subject, n(finding.now), n(finding.baseline))
      case 'slower_than_usual':
        return t.findings.slowerThanUsual(finding.subject, n(finding.now), n(finding.baseline))
    }
  }

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">{t.findings.title}</h3>
        <span className="tabular rounded-full bg-surface-inset px-1.5 py-0.5 text-xs text-fg-muted">
          {findings.length}
        </span>
        <p className="ml-auto hidden text-xs text-fg-subtle sm:block">{t.findings.subtitle}</p>
      </div>

      <ul className="-mx-2 divide-y divide-border/60">
        {findings.map((finding) => {
          const color = FINDING_COLOR[finding.kind]
          const strip = sparklineRange(finding, from, to)
          return (
            <li key={`${finding.kind}\n${finding.subject}`}>
              <button
                type="button"
                onClick={() => openEvents(finding)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-hover"
              >
                {/* the chip is the direct label, so identity never rests on the hue alone */}
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium"
                  style={
                    {
                      color,
                      background: `color-mix(in oklab, ${color} 16%, transparent)`,
                    } as CSSProperties
                  }
                >
                  {t.findings.kind[finding.kind]}
                </span>
                {/* text keeps text tokens: the mark beside it carries the colour, not the words */}
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{describe(finding)}</span>
                <span className="shrink-0">
                  <Sparkline filter={finding.filter} color={color} from={strip.from} to={strip.to} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
