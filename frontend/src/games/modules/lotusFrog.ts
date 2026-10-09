import type { GameModule, ScoreContribution, TargetId } from '../../lib/scoring/types'
import { clamp, isRecord, num, round2, round3 } from './helpers'

/**
 * Lotus Frog: its own path, unchanged (docs/MASTER_PROMPT.md, A.4).
 *
 * The pond reads four domains at once from how she plays (and dampens an
 * abandoned visit to 40%); that reading is made by the game's own report and
 * arrives here already scored as {@link FrogReading}s. This module therefore
 * scores nothing itself: {@link frogContributions} only reshapes the game's
 * readings into the contract, and {@code precomputed} tells the server to take
 * them as they are and never re-score them.
 *
 * What this cannot tell: how the pond arrived at a reading. The tablet sends
 * the report's raw behavioural breakdown as the session's trials, so it is kept,
 * but nothing downstream interprets it.
 */

export interface FrogReading {
  /** The pond's own domain name, as the report uses it. */
  domain: string
  /** 0 to 1, or null when the pond did not measure it. */
  score: number | null
  /** 0 to 1, with abandonment already folded in. */
  confidence: number
}

const TARGET_OF: Record<string, TargetId> = {
  visualSemantic: 'VISUAL_SEMANTIC',
  motor: 'MOTOR',
  affective: 'AFFECTIVE',
  temporal: 'TEMPORAL',
}

const WORDS: Record<string, string> = {
  visualSemantic: 'recognising and following the pond’s shapes',
  motor: 'the steadiness of her hand',
  affective: 'how settled she was',
  temporal: 'her sense of rhythm and timing',
}

export function frogContributions(readings: readonly FrogReading[], abandoned: boolean): ScoreContribution[] {
  const out: ScoreContribution[] = []
  for (const r of readings) {
    const target = TARGET_OF[r.domain]
    if (!target || r.score === null || !Number.isFinite(r.score) || !(r.confidence > 0)) continue
    out.push({
      target,
      raw: round2(clamp(r.score * 100, 0, 100)),
      confidence: round3(clamp(r.confidence, 0, 1)),
      because: `The pond’s own reading of ${WORDS[r.domain]}${abandoned ? ', counted lightly because she left early' : ''}. It is taken as the game computed it.`,
    })
  }
  return out
}

/** For symmetry with the other modules; the pond's readings are never rebuilt from trials. */
function fromTrials(trials: readonly unknown[]): ScoreContribution[] {
  const rows = trials.filter(isRecord)
  return frogContributions(
    rows.map((t) => ({ domain: String(t.domain ?? ''), score: num(t.score), confidence: num(t.confidence) ?? 0 })),
    false,
  )
}

export const lotusFrog: GameModule = {
  id: 'lotus-frog',
  gameType: 'LOTUS_FROG',
  title: 'The Lotus Frog',
  route: '/game/lotus-frog',
  primaryDomains: ['MOTOR'],
  targets: ['MOTOR', 'VISUAL_SEMANTIC', 'AFFECTIVE', 'TEMPORAL'],
  precomputed: true,
  scoreSession: (trials) => fromTrials(trials),
}
