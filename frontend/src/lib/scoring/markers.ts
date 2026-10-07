/**
 * Clinician markers: plain numbers a doctor recognises, reported beside the
 * domain levels and never folded into them.
 */

import type { SessionMarkers } from './types'

export interface SpanRound {
  spanLength: number
  /** Ordered correctly on the first attempt, with no wrong taps. */
  clean: boolean
}

/**
 * Working-memory span: the largest span at which at least 70% of rounds were
 * clean, counting only spans attempted at least twice. Undefined when no span
 * qualifies, which is different from a span of zero.
 */
export function workingMemorySpan(rounds: readonly SpanRound[], minRounds = 2, minCleanRate = 0.7): number | undefined {
  const bySpan = new Map<number, { total: number; clean: number }>()
  for (const r of rounds) {
    if (!Number.isFinite(r.spanLength)) continue
    const tally = bySpan.get(r.spanLength) ?? { total: 0, clean: 0 }
    tally.total += 1
    if (r.clean) tally.clean += 1
    bySpan.set(r.spanLength, tally)
  }
  let best: number | undefined
  for (const [span, tally] of bySpan) {
    if (tally.total < minRounds || tally.clean / tally.total < minCleanRate) continue
    if (best === undefined || span > best) best = span
  }
  return best
}

/** Later markers replace earlier ones; a marker the new session did not measure is kept. */
export function mergeMarkers(previous: SessionMarkers | undefined, next: SessionMarkers | undefined): SessionMarkers {
  const merged: SessionMarkers = { ...(previous ?? {}) }
  for (const [key, value] of Object.entries(next ?? {}) as [keyof SessionMarkers, number | undefined][]) {
    if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value
  }
  return merged
}
