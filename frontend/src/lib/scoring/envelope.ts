import type { GameModule, ScoreContribution, SessionEnvelope, SessionMarkers } from './types'
import { ENGINE_VERSION } from './types'

/**
 * Making the envelope a finished session travels in (docs/MASTER_PROMPT.md, A.1).
 *
 * The device is the one that scores, so the envelope carries the contributions
 * it computed and the raw trials they came from. Before it leaves, anything
 * the server would refuse is removed here, because the server refuses a whole
 * session for one bad contribution and a session lost to a stray target is a
 * session of hers that never reaches her family.
 */

export interface EnvelopeInput {
  patientId: string
  module: Pick<GameModule, 'id' | 'targets' | 'precomputed'>
  /** Epoch milliseconds. */
  startedAt: number
  durationMs: number
  completed: boolean
  abandoned: boolean
  moodAtStart: string | null
  difficulty: { tier: number; params?: Record<string, number | string> }
  trials: readonly unknown[]
  contributions: readonly ScoreContribution[]
  markers?: SessionMarkers
}

/** Only what the game may say, once per target, with something to say it with. */
export function usableContributions(
  contributions: readonly ScoreContribution[],
  allowed: readonly string[],
): ScoreContribution[] {
  const seen = new Set<string>()
  const out: ScoreContribution[] = []
  for (const c of contributions) {
    if (!allowed.includes(c.target) || seen.has(c.target)) continue
    if (!Number.isFinite(c.raw) || !Number.isFinite(c.confidence) || c.confidence <= 0) continue
    seen.add(c.target)
    out.push({
      target: c.target,
      raw: Math.max(0, Math.min(100, c.raw)),
      confidence: Math.max(0, Math.min(1, c.confidence)),
      because: c.because,
    })
  }
  return out
}

export function buildEnvelope(input: EnvelopeInput): SessionEnvelope {
  const started = new Date(input.startedAt)
  return {
    clientSessionId: crypto.randomUUID(),
    patientId: input.patientId,
    gameId: input.module.id,
    startedAt: started.toISOString(),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    completed: input.completed,
    abandoned: input.abandoned,
    hourOfDay: started.getHours(),
    moodAtStart: input.moodAtStart,
    difficulty: { tier: input.difficulty.tier, params: input.difficulty.params ?? {} },
    trials: [...input.trials],
    contributions: usableContributions(input.contributions, input.module.targets),
    ...(input.markers && Object.keys(input.markers).length > 0 ? { markers: input.markers } : {}),
    ...(input.module.precomputed ? { precomputedReading: true } : {}),
    engineVersion: ENGINE_VERSION,
  }
}
