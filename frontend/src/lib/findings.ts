import type { Finding, FindingKind } from '../types'
import { LEVEL_CHART } from './levels'
import { SERIES } from './series'

/**
 * The hue a finding is drawn in.
 *
 * Not a new palette — each kind takes the colour this dashboard already draws that measurement
 * in, so a reader carries the meaning across from the tiles and the timeline without learning
 * anything. That is the whole trick: the violet on a "slower than usual" row is the same violet
 * as the P95 LATENCY tile and the p95 line in the Duration lane, because it is the same number.
 *
 * new_exception is the one that is not a measured series, so it takes a severity hue instead.
 * Warning rather than Error on purpose: a type nobody has seen before is a heads-up, not a
 * verdict — and error red is already spoken for by the row directly above it.
 *
 * Validated as a categorical set against the dark canvas (#0a0f11): adjacent-pair CVD ΔE 10.6
 * worst case, normal-vision 21.2, all four over 3:1 contrast. An earlier attempt used the fatal
 * pink for new_exception and failed outright — pink against error red came out at ΔE 10.4 for
 * normal vision, below the floor where two hues are tellable apart at all.
 */
export const FINDING_COLOR: Record<FindingKind, string> = {
  /** A volume that fell to nothing. */
  went_quiet: SERIES.volume,
  /** Not a series — a severity, and the mildest one that still means "look". */
  new_exception: LEVEL_CHART.Warning,
  /** A failure rate. */
  failing_route: SERIES.errors,
  /** A p95 regression, drawn in the p95 hue. */
  slower_than_usual: SERIES.p95,
}

/**
 * The window a finding's sparkline is drawn over.
 *
 * Everything but silence is drawn over the range the reader picked, because that is where the
 * thing happened. Silence is the exception and it is the reason this function exists: a service
 * that sent nothing has an empty strip, which is a picture of no data rather than a picture of
 * stopping. Reaching back over the baseline the detector used instead draws it running and then
 * flatlining — the finding itself, in one strip, with no number to read.
 */
export function sparklineRange(finding: Finding, from: string, to: string): { from: string; to: string } {
  if (finding.kind !== 'went_quiet') {
    return { from, to }
  }
  const start = new Date(from).getTime()
  const span = Math.max(1, new Date(to).getTime() - start)
  // mirrors FindingScanner: four windows, never more than a day. Both halves matter — four
  // windows is what "usually N" was computed from, and the cap is what stops a 24 h range from
  // drawing four days. If the scanner's numbers move, this moves with them or the strip stops
  // being a picture of the sentence beside it.
  const baseline = Math.min(span * BASELINE_WINDOWS, MAX_BASELINE_MS)
  return { from: new Date(start - baseline).toISOString(), to }
}

const BASELINE_WINDOWS = 4
const MAX_BASELINE_MS = 24 * 60 * 60 * 1000
