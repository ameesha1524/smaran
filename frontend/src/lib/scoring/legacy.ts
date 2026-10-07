/**
 * The bridge between the engine (0–100, `LANGUAGE`…`EXECUTIVE`) and the
 * shapes the rest of the app still speaks (0–1, `language`…`executiveFunction`).
 *
 * Games currently hand `completeSession` a set of 0–1 domain readings. Those
 * become contributions here, go through the engine, and the engine's levels
 * are projected back to `domainScores` for routing and the current dashboard.
 * The engine state is the truth; `domainScores` is a view of it.
 *
 * Mirrored by backend/.../scoring/LegacyScores.java.
 */

import type { Domain, DomainReadings, DomainScores } from '../types'
import { initialTargetState } from './engine'
import { DEFAULT_CONFIG, type DomainId, type ScoreContribution, type ScoringConfig, type ScoringState } from './types'

export const DOMAIN_ID_OF: Record<Domain, DomainId> = {
  language: 'LANGUAGE',
  visualSemantic: 'VISUAL_SEMANTIC',
  motor: 'MOTOR',
  affective: 'AFFECTIVE',
  temporal: 'TEMPORAL',
  executiveFunction: 'EXECUTIVE',
}

const LEGACY_DOMAINS = Object.keys(DOMAIN_ID_OF) as Domain[]

/** 0–1 readings → engine contributions, in the fixed domain order. */
export function contributionsFromReadings(readings: DomainReadings, because = ''): ScoreContribution[] {
  const out: ScoreContribution[] = []
  for (const d of LEGACY_DOMAINS) {
    const r = readings[d]
    if (!r) continue
    out.push({ target: DOMAIN_ID_OF[d], raw: r.score * 100, confidence: r.confidence, because })
  }
  return out
}

/**
 * Seed an engine state from a profile saved before the engine existed. Each
 * level carries over; there is no history, so observations start at zero and
 * the domain has to earn its confidence again.
 */
export function stateFromDomainScores(scores: Partial<DomainScores>, config: ScoringConfig = DEFAULT_CONFIG): ScoringState {
  const state: ScoringState = {}
  for (const d of LEGACY_DOMAINS) {
    const score = scores[d]
    if (typeof score !== 'number' || !Number.isFinite(score)) continue
    state[DOMAIN_ID_OF[d]] = { ...initialTargetState(config), level: Math.max(0, Math.min(1, score)) * 100 }
  }
  return state
}

/** Engine levels → 0–1 domain scores. Domains the engine has not seen keep their previous value. */
export function domainScoresFrom(state: ScoringState, previous: DomainScores): DomainScores {
  const next: DomainScores = { ...previous }
  for (const d of LEGACY_DOMAINS) {
    const target = state[DOMAIN_ID_OF[d]]
    if (target) next[d] = Number((target.level / 100).toFixed(3))
  }
  return next
}
