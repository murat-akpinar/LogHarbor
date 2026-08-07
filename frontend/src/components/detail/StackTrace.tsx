import { groupFrames, parseStackTrace, shortPath } from '../../lib/stackTrace'
import type { StackFrame } from '../../lib/stackTrace'
import { Highlighted } from '../Highlighted'
import { useI18n } from '../../i18n'

/** How many frames of a run are worth showing before the run is worth collapsing. */
const COLLAPSE_OVER = 2

interface StackTraceProps {
  text: string
  highlightTerms: string[]
}

function FrameRow({ frame, highlightTerms }: { frame: StackFrame; highlightTerms: string[] }) {
  const { t } = useI18n()
  const muted = frame.kind !== 'app'
  return (
    <li className="py-0.5">
      <div className="flex min-w-0 items-baseline gap-2">
        {frame.file !== null ? (
          <span
            className={`min-w-0 truncate font-mono text-xs ${muted ? 'text-fg-subtle' : 'text-fg'}`}
            title={frame.line === null ? frame.file : `${frame.file}:${frame.line}`}
          >
            {shortPath(frame.file)}
            {frame.line !== null && <span className="text-fg-subtle">:{frame.line}</span>}
          </span>
        ) : (
          <span className="truncate font-mono text-xs text-fg-subtle">{t.detail.stackNoFile}</span>
        )}
      </div>
      {frame.fn !== null && (
        <div className="truncate font-mono text-[0.6875rem] text-fg-subtle" title={frame.fn}>
          {frame.fn}
        </div>
      )}
      {frame.detail.map((line) => (
        <div key={line} className="truncate font-mono text-[0.6875rem] text-fg-muted">
          <Highlighted text={line} terms={highlightTerms} />
        </div>
      ))}
    </li>
  )
}

/**
 * The stack trace as frames rather than as sixty lines of text.
 *
 * What an operator wants from a trace is the first line that belongs to their own code, and
 * everything else is context they read only if that line is not enough. So the application's
 * frames stay open, the runs of framework and runtime frames between them collapse to one row
 * each, and the raw text is one click away — a viewer that cannot be checked against what
 * actually arrived is a viewer nobody should trust.
 */
export function StackTrace({ text, highlightTerms }: StackTraceProps) {
  const { t, lang } = useI18n()
  const stack = parseStackTrace(text)

  // nothing recognisable in it: show what arrived, exactly as before
  if (stack.frames.length === 0) {
    return (
      <pre className="rounded-well bg-level-error/[0.07] p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-level-error ring-1 ring-level-error/15">
        <Highlighted text={text} terms={highlightTerms} />
      </pre>
    )
  }

  const groups = groupFrames(stack.frames)

  return (
    <div className="rounded-well bg-level-error/[0.07] p-3 ring-1 ring-level-error/15">
      {stack.header.length > 0 && (
        <p className="mb-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-level-error">
          <Highlighted text={stack.header.join('\n')} terms={highlightTerms} />
        </p>
      )}

      <p className="mb-2 text-[0.6875rem] text-fg-subtle">
        {t.detail.stackSummary(
          stack.counts.total.toLocaleString(lang),
          stack.counts.app.toLocaleString(lang),
        )}
        {stack.runtime !== 'unknown' && <span className="ml-1.5 font-mono">· {stack.runtime}</span>}
      </p>

      <ol className="flex flex-col divide-y divide-white/[0.04]">
        {groups.map((group, groupIndex) => {
          const collapsible = group.kind !== 'app' && group.frames.length > COLLAPSE_OVER
          if (!collapsible) {
            return group.frames.map(({ frame, index }) => (
              <div
                key={index}
                // the frame the reader is looking for takes the only mark in the list
                className={index === stack.culpritIndex ? 'border-l-2 border-accent pl-2' : 'pl-2.5'}
              >
                <FrameRow frame={frame} highlightTerms={highlightTerms} />
              </div>
            ))
          }
          return (
            <details key={groupIndex} className="py-0.5 pl-2.5">
              <summary className="cursor-pointer font-mono text-[0.6875rem] text-fg-subtle hover:text-fg-muted">
                {t.detail.stackElsewhere(group.frames.length.toLocaleString(lang))}
              </summary>
              <ul className="mt-1 border-l border-border pl-2">
                {group.frames.map(({ frame, index }) => (
                  <FrameRow key={index} frame={frame} highlightTerms={highlightTerms} />
                ))}
              </ul>
            </details>
          )
        })}
      </ol>

      {stack.trailer.length > 0 && (
        <p className="mt-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-level-error/80">
          <Highlighted text={stack.trailer.join('\n')} terms={highlightTerms} />
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[0.6875rem] text-fg-subtle hover:text-fg-muted">
          {t.detail.stackRaw}
        </summary>
        <pre className="mt-1 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-level-error/80">
          <Highlighted text={text} terms={highlightTerms} />
        </pre>
      </details>
    </div>
  )
}
