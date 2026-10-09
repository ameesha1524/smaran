import type { GameModule, ScoreContribution } from '../../lib/scoring/types'
import { clamp, isRecord, mean, num, plural, round2, round3, trialConfidence, SECONDARY } from './helpers'

/**
 * Family Grove: VISUAL_SEMANTIC (primary) and AFFECTIVE (secondary).
 *
 * A face (and, where the family recorded one, a voice) comes up and she chooses
 * the name or the picture that belongs to it. A wrong choice drifts gently home;
 * the round continues until she has it.
 *
 * A trial is one round:
 *
 *   memberId     who was being asked about
 *   phase        how much help she was given (1 name shown, 4 recall)
 *   wrongTaps    choices before the right one
 *   latencyMs    from the question to the right answer, or null
 *
 *   round score (recognition)  right first time: 100 minus up to 25 for a slow
 *                              answer, 0.25 * clamp((latency - 2000) / 6000, 0, 1) * 100;
 *                              otherwise max(35, 80 - 20 * wrongTaps)
 *   VISUAL_SEMANTIC            raw = mean round score
 *                              confidence = max(0.15, min(1, rounds / 5))
 *   AFFECTIVE                  raw = 100 when she knew them first time, else 40,
 *                              averaged; at 0.5 of the confidence
 *
 * What this cannot tell: affect. Recognising the people she loves is a warm
 * and meaningful thing to measure, but it is recognition, not mood. The
 * AFFECTIVE line is a weak proxy and is weighted as one. Voice-hint use is not
 * recorded yet, so a round heard with the voice and one without read alike.
 */

interface Round {
  wrong: number
  latency: number | null
}

function rounds(trials: readonly unknown[]): Round[] {
  const out: Round[] = []
  for (const t of trials) {
    if (!isRecord(t)) continue
    const wrong = num(t.wrongTaps)
    if (wrong === null) continue
    out.push({ wrong: Math.max(0, wrong), latency: num(t.latencyMs) })
  }
  return out
}

export function scoreGrove(trials: readonly unknown[]): ScoreContribution[] {
  const rs = rounds(trials)
  if (rs.length === 0) return []
  const confidence = trialConfidence(rs.length, 5)
  const first = rs.filter((r) => r.wrong === 0).length

  const recognition = rs.map((r) =>
    r.wrong === 0
      ? 100 - 25 * clamp(((r.latency ?? 2000) - 2000) / 6000, 0, 1)
      : Math.max(35, 80 - 20 * r.wrong),
  )

  return [
    {
      target: 'VISUAL_SEMANTIC',
      raw: round2(clamp(mean(recognition), 0, 100)),
      confidence: round3(confidence),
      because: `Knew the right face or name first time in ${first} of ${rs.length} ${plural(rs.length, 'round')}.`,
    },
    {
      target: 'AFFECTIVE',
      raw: round2(mean(rs.map((r) => (r.wrong === 0 ? 100 : 40)))),
      confidence: round3(SECONDARY.half * confidence),
      because: `Recognised her own people straight away ${first} of ${rs.length} ${plural(rs.length, 'time')}. This is recognition, a gentle stand-in for how connected she feels, and is weighed lightly.`,
    },
  ]
}

export const familyGrove: GameModule = {
  id: 'family-grove',
  gameType: 'FAMILY_GROVE',
  title: 'Family Grove',
  route: '/game/family-grove',
  primaryDomains: ['VISUAL_SEMANTIC'],
  targets: ['VISUAL_SEMANTIC', 'AFFECTIVE'],
  scoreSession: (trials) => scoreGrove(trials),
}
