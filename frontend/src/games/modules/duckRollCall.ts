import { workingMemorySpan } from '../../lib/scoring/markers'
import type { GameModule, ScoreContribution, SessionMarkers } from '../../lib/scoring/types'
import { clamp, isRecord, mean, num, plural, round2, round3, trialConfidence, SECONDARY } from './helpers'

/**
 * Duck Roll Call, scored (docs/MASTER_PROMPT.md, Appendix A.5).
 *
 * The Java twin is backend/.../scoring/DuckRollCallScoring.java. Both are held
 * to duck-roll-call-vectors.json by a test on each side, and the server scores
 * the raw trials again when a session arrives and counts any disagreement.
 *
 * What a trial is: one round. All the ducklings flash a number together, the
 * numbers vanish, and she taps them in ascending order from memory.
 *
 *   spanLength            how many ducklings (3 to 6)
 *   flashDurationMs       how long the numbers showed (2000 down to 800)
 *   correctFirstAttempt   no wrong taps in the round
 *   attempts              wrong taps + 1
 *   firstErrorAtPosition  where in the order the first wrong tap fell, or null
 *   timeToFirstTapMs      how long before she began, or null
 *   completedRound        false if she left in the middle of it
 *   positionReached       correct taps made (used only when not completed)
 *
 * The scores:
 *
 *   effective span   a clean round = N; a round with wrong taps = N - 0.5;
 *                    a round left unfinished = the position she reached
 *   flash bonus      up to +25% for a shorter flash:
 *                    0.25 * clamp((2000 - flash) / 1200, 0, 1)
 *   round score      effective span * (1 + flash bonus)
 *   EXECUTIVE and WORKING_MEMORY_SPAN
 *                    raw = clamp(100 * mean(round score) / 6, 0, 100), so a clean
 *                    span of 3 at the slow flash reads 50 and a clean 6 reads 100
 *   VISUAL_SEMANTIC  (weak) retrieval speed:
 *                    speed = clamp((6000 - time to first tap) / 5000, 0, 1),
 *                    raw = 100 * mean(speed), at 0.4 of the confidence
 *   confidence       max(0.15, min(1, rounds / 8))
 *
 * Marker: working-memory span, the largest span with at least 70% clean rounds
 * over at least two rounds (lib/scoring/markers.ts).
 */

export interface DuckTrial {
  spanLength: number
  flashDurationMs: number
  correctFirstAttempt: boolean
  attempts: number
  firstErrorAtPosition: number | null
  timeToFirstTapMs: number | null
  completedRound: boolean
  positionReached?: number
}

interface Round {
  span: number
  flash: number
  clean: boolean
  completed: boolean
  reached: number
  firstTap: number | null
}

function rounds(trials: readonly unknown[]): Round[] {
  const out: Round[] = []
  for (const t of trials) {
    if (!isRecord(t)) continue
    const span = num(t.spanLength)
    const flash = num(t.flashDurationMs)
    if (span === null || flash === null) continue
    out.push({
      span,
      flash,
      clean: t.correctFirstAttempt === true,
      completed: t.completedRound !== false,
      reached: num(t.positionReached) ?? 0,
      firstTap: num(t.timeToFirstTapMs),
    })
  }
  return out
}

const effectiveSpan = (r: Round): number => (r.completed ? (r.clean ? r.span : r.span - 0.5) : r.reached)
const flashBonus = (r: Round): number => 0.25 * clamp((2000 - r.flash) / 1200, 0, 1)

export function scoreDuck(trials: readonly unknown[]): ScoreContribution[] {
  const rs = rounds(trials)
  if (rs.length === 0) return []

  const meanScore = mean(rs.map((r) => effectiveSpan(r) * (1 + flashBonus(r))))
  const raw = round2(clamp((100 * meanScore) / 6, 0, 100))
  const confidence = round3(trialConfidence(rs.length, 8))

  const meanSpan = mean(rs.map(effectiveSpan))
  const clean = rs.filter((r) => r.completed && r.clean).length
  const heldIn = `Held about ${meanSpan.toFixed(1)} ducklings in mind across ${rs.length} ${plural(rs.length, 'round')}, ${clean} of them with no wrong tap.`

  const out: ScoreContribution[] = [
    { target: 'EXECUTIVE', raw, confidence, because: heldIn },
    { target: 'WORKING_MEMORY_SPAN', raw, confidence, because: heldIn },
  ]

  const taps = rs.map((r) => r.firstTap).filter((t): t is number => t !== null)
  if (taps.length > 0) {
    const speed = mean(taps.map((t) => clamp((6000 - t) / 5000, 0, 1)))
    out.push({
      target: 'VISUAL_SEMANTIC',
      raw: round2(100 * speed),
      confidence: round3(SECONDARY.weak * trialConfidence(rs.length, 8)),
      because: `Began to tap about ${(mean(taps) / 1000).toFixed(1)} seconds after the numbers vanished: a light read on how quickly she retrieves what she saw.`,
    })
  }
  return out
}

export function duckMarkers(trials: readonly unknown[]): SessionMarkers | undefined {
  const rs = rounds(trials)
  if (rs.length === 0) return undefined
  const span = workingMemorySpan(rs.map((r) => ({ spanLength: r.span, clean: r.completed && r.clean })))
  return span === undefined ? undefined : { workingMemorySpan: span }
}

export const duckRollCall: GameModule = {
  id: 'duck-roll-call',
  gameType: 'DUCK_ROLL_CALL',
  title: 'Duck Roll Call',
  route: '/game/duck-roll-call',
  primaryDomains: ['EXECUTIVE'],
  targets: ['EXECUTIVE', 'WORKING_MEMORY_SPAN', 'VISUAL_SEMANTIC'],
  scoreSession: (trials) => scoreDuck(trials),
  markers: duckMarkers,
}
