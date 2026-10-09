import type { GameModule, ScoreContribution } from '../../lib/scoring/types'
import { clamp, isRecord, num, plural, round2, round3, trialConfidence, SECONDARY } from './helpers'

/**
 * Morning Rituals: TEMPORAL (primary) and EXECUTIVE (secondary).
 *
 * The morning's icons are put back in order along a sunrise. A misplaced icon
 * drifts softly home; there is no "wrong" on screen, but each attempt is
 * recorded.
 *
 * A trial is one placement attempt:
 *
 *   itemId      which icon
 *   slotIndex   where she put it (0-based)
 *   correct     whether it belonged there
 *   latencyMs   from picking it up to putting it down, or null
 *
 *   TEMPORAL    raw = 100 * correct attempts / attempts: how much of what she
 *               tried was in the right order
 *               confidence = max(0.15, min(1, attempts / 6))
 *   EXECUTIVE   errors per item placed: e = wrong attempts / correct attempts,
 *               raw = clamp(100 - 40 * e, 0, 100), at 0.6 of the confidence
 *
 * What this cannot tell: a misplacement may be an order she no longer holds, a
 * slip of the hand, or a different morning (the icons are the content's idea of a
 * morning, not hers). The family can replace them with her own routine.
 */

interface Attempt {
  correct: boolean
}

function attempts(trials: readonly unknown[]): Attempt[] {
  const out: Attempt[] = []
  for (const t of trials) {
    if (!isRecord(t) || num(t.slotIndex) === null) continue
    out.push({ correct: t.correct === true })
  }
  return out
}

export function scoreRituals(trials: readonly unknown[]): ScoreContribution[] {
  const as = attempts(trials)
  if (as.length === 0) return []
  const right = as.filter((a) => a.correct).length
  const wrong = as.length - right
  const confidence = trialConfidence(as.length, 6)

  const out: ScoreContribution[] = [
    {
      target: 'TEMPORAL',
      raw: round2(clamp((100 * right) / as.length, 0, 100)),
      confidence: round3(confidence),
      because: `${right} of ${as.length} ${plural(as.length, 'placement')} were in the right place along the morning.`,
    },
  ]
  if (right > 0) {
    out.push({
      target: 'EXECUTIVE',
      raw: round2(clamp(100 - 40 * (wrong / right), 0, 100)),
      confidence: round3(SECONDARY.firm * confidence),
      because:
        wrong === 0
          ? 'Put every step where it belonged without a misplacement.'
          : `Needed ${wrong} ${plural(wrong, 'extra try', 'extra tries')} to order ${right} ${plural(right, 'step')}.`,
    })
  }
  return out
}

export const morningRituals: GameModule = {
  id: 'morning-rituals',
  gameType: 'MORNING_RITUALS',
  title: 'Morning Rituals',
  route: '/game/morning-rituals',
  primaryDomains: ['TEMPORAL'],
  targets: ['TEMPORAL', 'EXECUTIVE'],
  scoreSession: (trials) => scoreRituals(trials),
}
