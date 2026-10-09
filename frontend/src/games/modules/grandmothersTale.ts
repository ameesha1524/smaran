import type { GameModule, ScoreContribution } from '../../lib/scoring/types'
import { clamp, isRecord, mean, num, plural, round2, round3, trialConfidence, SECONDARY } from './helpers'

/**
 * Grandmother's Tale: LANGUAGE (primary) and SUSTAINED_ATTENTION (secondary).
 *
 * A story plays, and she chooses the picture that completes it. Hearing it
 * again is free and never discouraged; it is counted, because a rising replay
 * count is a real signal, but it is never held against her in the game.
 *
 * A trial is one story:
 *
 *   storyId        which story
 *   wrongTaps      pictures she chose before the right one
 *   replays        times she asked to hear it again
 *   latencyMs      from the question to her answer, or null
 *
 * She always ends on the right picture (the story moves on only then), so what
 * differs between sittings is how directly she got there.
 *
 *   story score (language)   100 for the right picture first time,
 *                            else max(40, 100 - 20 * wrongTaps)
 *   LANGUAGE                 raw = mean story score
 *                            confidence = max(0.15, min(1, stories / 4))
 *   story score (attention)  max(40, 100 - 15 * replays)
 *   SUSTAINED_ATTENTION      raw = mean of that, at 0.6 of the confidence
 *
 * What this cannot tell: why she listened again. A replay may be fine hearing,
 * a wish to hear it once more, or a lapse. The attention score is a prompt to
 * look at the trend, not a finding. Stories are few and fixed in the demo
 * content; with real family stories the sittings will be longer.
 */

interface Story {
  wrong: number
  replays: number
}

function stories(trials: readonly unknown[]): Story[] {
  const out: Story[] = []
  for (const t of trials) {
    if (!isRecord(t)) continue
    const wrong = num(t.wrongTaps)
    if (wrong === null) continue
    out.push({ wrong: Math.max(0, wrong), replays: Math.max(0, num(t.replays) ?? 0) })
  }
  return out
}

export function scoreTale(trials: readonly unknown[]): ScoreContribution[] {
  const ss = stories(trials)
  if (ss.length === 0) return []
  const confidence = trialConfidence(ss.length, 4)
  const first = ss.filter((s) => s.wrong === 0).length
  const replays = ss.reduce((a, s) => a + s.replays, 0)

  return [
    {
      target: 'LANGUAGE',
      raw: round2(clamp(mean(ss.map((s) => (s.wrong === 0 ? 100 : Math.max(40, 100 - 20 * s.wrong)))), 0, 100)),
      confidence: round3(confidence),
      because: `Chose the right picture first time in ${first} of ${ss.length} ${plural(ss.length, 'story', 'stories')}.`,
    },
    {
      target: 'SUSTAINED_ATTENTION',
      raw: round2(clamp(mean(ss.map((s) => Math.max(40, 100 - 15 * s.replays))), 0, 100)),
      confidence: round3(SECONDARY.firm * confidence),
      because:
        replays === 0
          ? 'Listened through each story without asking to hear it again.'
          : `Asked to hear a story again ${replays} ${plural(replays, 'time')} across ${ss.length} ${plural(ss.length, 'story', 'stories')}. Hearing it twice is not a problem; it is the trend that matters.`,
    },
  ]
}

export const grandmothersTale: GameModule = {
  id: 'grandmothers-tale',
  gameType: 'GRANDMOTHERS_TALE',
  title: "Grandmother's Tale",
  route: '/game/grandmothers-tale',
  primaryDomains: ['LANGUAGE'],
  targets: ['LANGUAGE', 'SUSTAINED_ATTENTION'],
  scoreSession: (trials) => scoreTale(trials),
}
