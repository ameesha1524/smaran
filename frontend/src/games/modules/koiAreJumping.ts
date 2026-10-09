import type { GameModule, ScoreContribution } from '../../lib/scoring/types'
import { clamp, isRecord, mean, num, plural, round2, round3, trialConfidence, SECONDARY } from './helpers'

/**
 * The Koi Are Jumping: MOTOR (primary) and REACTION_SPEED (secondary).
 *
 * A koi leaps and she taps it. A trial is one leap:
 *
 *   wasTapped    whether she answered at all
 *   reactionMs   from the leap's start to her tap, or null
 *   leapMs       how long the leap lasted (they vary)
 *
 *   MOTOR           raw = 100 * (0.7 * hit rate + 0.3 * mean speed), speed being
 *                   clamp(1 - reaction / leap, 0, 1) over the leaps she tapped
 *                   (0 if she tapped none)
 *                   confidence = max(0.15, min(1, leaps / 6))
 *   REACTION_SPEED  only if she tapped at least one: raw = 100 * mean speed,
 *                   at 0.6 of the confidence
 *
 * This is not the inhibition version in the prompt (leave the wrong creature
 * alone): the game has no creature to leave, so nothing here measures
 * INHIBITORY_CONTROL. That needs a design decision about the game first.
 */

interface Leap {
  tapped: boolean
  speed: number | null
}

function leaps(trials: readonly unknown[]): Leap[] {
  const out: Leap[] = []
  for (const t of trials) {
    if (!isRecord(t) || typeof t.wasTapped !== 'boolean') continue
    const reaction = num(t.reactionMs)
    const leap = num(t.leapMs)
    out.push({
      tapped: t.wasTapped && reaction !== null,
      speed: t.wasTapped && reaction !== null ? clamp(1 - reaction / Math.max(1, leap ?? 1), 0, 1) : null,
    })
  }
  return out
}

export function scoreKoi(trials: readonly unknown[]): ScoreContribution[] {
  const ls = leaps(trials)
  if (ls.length === 0) return []
  const tapped = ls.filter((l) => l.tapped)
  const hitRate = tapped.length / ls.length
  const speed = tapped.length ? mean(tapped.map((l) => l.speed as number)) : 0
  const confidence = trialConfidence(ls.length, 6)

  const out: ScoreContribution[] = [
    {
      target: 'MOTOR',
      raw: round2(clamp(100 * (tapped.length ? 0.7 * hitRate + 0.3 * speed : 0), 0, 100)),
      confidence: round3(confidence),
      because: `Tapped ${tapped.length} of ${ls.length} ${plural(ls.length, 'leap')}, and ${tapped.length ? `on average ${Math.round(speed * 100)}% of the way through the leap before answering` : 'did not answer these'}.`,
    },
  ]
  if (tapped.length > 0) {
    out.push({
      target: 'REACTION_SPEED',
      raw: round2(100 * speed),
      confidence: round3(SECONDARY.firm * confidence),
      because: 'How early in each leap she answered: sooner reads higher.',
    })
  }
  return out
}

export const koiAreJumping: GameModule = {
  id: 'koi-are-jumping',
  gameType: 'KOI_ARE_JUMPING',
  title: 'The Koi Are Jumping',
  route: '/game/koi-are-jumping',
  primaryDomains: ['MOTOR'],
  targets: ['MOTOR', 'REACTION_SPEED'],
  scoreSession: (trials) => scoreKoi(trials),
}
