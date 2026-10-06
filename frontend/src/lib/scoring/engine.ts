/**
 * The scoring engine. Pure functions, no clock, no storage, no randomness.
 *
 * For each contribution on a domain or sub-signal, in `startedAt` order:
 *
 *   alpha     = baseAlpha × confidence                       (0.25 × confidence)
 *   baseline  = mean of the prior raws      (the prior level until there are 3)
 *   sd        = sample SD of the prior raws (12 until there are 5; never below 3)
 *   velocity  = (raw − baseline) / sd
 *   level'    = level × (1 − alpha) + raw × alpha            (starts at 50)
 *   domain confidence = min(1, observations / 12)
 *   status    = stable while domain confidence < 0.35, otherwise from velocity:
 *               ≤ −1.5 decline · ≤ −0.8 watch · ≥ 1.0 improving · else stable
 *
 * "Prior" means before this contribution: the baseline is trailing, so a raw
 * is never compared against a mean that already contains it.
 *
 * Status is the single-session reading. Whether to raise an alert is a
 * separate question answered by the configured rule (see `alertFor`).
 *
 * The Java twin is backend/.../scoring/ScoringEngine.java, and the Python
 * port is data-science/src/scoring_core.py. All three are held to
 * golden-vectors.json. Change the arithmetic here and that file must be
 * regenerated (`npm run golden`), after which the other two fail until they
 * match.
 *
 * Arithmetic notes that matter for parity: sums run oldest-first, the SD
 * uses n − 1, and nothing is rounded inside the engine.
 */

import {
  DEFAULT_CONFIG,
  TARGET_IDS,
  type AlertSeverity,
  type Reading,
  type ScoreContribution,
  type ScoringConfig,
  type ScoringState,
  type Status,
  type TargetId,
  type TargetState,
} from './types'

export function initialTargetState(config: ScoringConfig = DEFAULT_CONFIG): TargetState {
  return { level: config.startLevel, observations: 0, raws: [], runWatch: 0, runDecline: 0, cusum: 0 }
}

/** A contribution the engine will accept, or null if it carries no usable evidence. */
export function sanitizeContribution(c: Pick<ScoreContribution, 'target' | 'raw' | 'confidence'>): {
  target: TargetId
  raw: number
  confidence: number
} | null {
  if (!c || !TARGET_IDS.includes(c.target)) return null
  if (!Number.isFinite(c.raw) || !Number.isFinite(c.confidence)) return null
  const confidence = clamp(c.confidence, 0, 1)
  if (confidence <= 0) return null
  return { target: c.target, raw: clamp(c.raw, 0, 100), confidence }
}

/** Apply one contribution to one target's state. */
export function applyToTarget(
  prior: TargetState | undefined,
  contribution: Pick<ScoreContribution, 'target' | 'raw' | 'confidence'>,
  config: ScoringConfig = DEFAULT_CONFIG,
): { state: TargetState; reading: Reading } | null {
  const c = sanitizeContribution(contribution)
  if (!c) return null
  const before = prior ?? initialTargetState(config)

  const n = before.raws.length
  const baseline = n >= config.minBaselineObservations ? mean(before.raws) : before.level
  const sd = n >= config.minSdObservations ? Math.max(config.minSd, sampleSd(before.raws)) : config.priorSd
  const velocity = (c.raw - baseline) / sd

  const alpha = config.baseAlpha * c.confidence
  const level = before.level * (1 - alpha) + c.raw * alpha
  const observations = before.observations + 1
  const raws = [...before.raws, c.raw].slice(-config.window)
  const domainConfidence = Math.min(1, observations / config.fullConfidenceObservations)

  const gated = domainConfidence < config.confidenceGate
  const status = gated ? 'stable' : statusFor(velocity, config)

  // All three rules' bookkeeping is kept on every step, so the rule can be
  // switched in config without replaying history.
  const runWatch = !gated && velocity <= config.watchVelocity ? before.runWatch + 1 : 0
  const runDecline = !gated && velocity <= config.declineVelocity ? before.runDecline + 1 : 0
  const cusum = gated ? 0 : Math.max(0, before.cusum + (-velocity - config.cusumK))

  const state: TargetState = { level, observations, raws, runWatch, runDecline, cusum }
  return {
    state,
    reading: {
      target: c.target,
      raw: c.raw,
      confidence: c.confidence,
      level,
      baseline,
      sd,
      velocity,
      domainConfidence,
      status,
      alert: gated ? null : alertFor(state, velocity, config),
    },
  }
}

/** Apply one session's contributions, in the order given. Unusable ones are skipped. */
export function applySession(
  state: ScoringState,
  contributions: readonly Pick<ScoreContribution, 'target' | 'raw' | 'confidence'>[],
  config: ScoringConfig = DEFAULT_CONFIG,
): { state: ScoringState; readings: Reading[] } {
  const next: ScoringState = { ...state }
  const readings: Reading[] = []
  for (const contribution of contributions) {
    const result = applyToTarget(next[contribution.target], contribution, config)
    if (!result) continue
    next[result.reading.target] = result.state
    readings.push(result.reading)
  }
  return { state: next, readings }
}

/**
 * Rebuild a state from scratch. `sessions` must already be in `startedAt`
 * order; the server uses this when an older session arrives late.
 */
export function replay(
  sessions: readonly (readonly Pick<ScoreContribution, 'target' | 'raw' | 'confidence'>[])[],
  config: ScoringConfig = DEFAULT_CONFIG,
  initial: ScoringState = {},
): ScoringState {
  let state = initial
  for (const contributions of sessions) state = applySession(state, contributions, config).state
  return state
}

export function statusFor(velocity: number, config: ScoringConfig = DEFAULT_CONFIG): Status {
  if (velocity <= config.declineVelocity) return 'decline'
  if (velocity <= config.watchVelocity) return 'watch'
  if (velocity >= config.improvingVelocity) return 'improving'
  return 'stable'
}

/**
 * Should this contribution raise an alert, under the configured rule?
 *
 *   SINGLE           the status of this one contribution
 *   TWO_CONSECUTIVE  two in a row at or below the threshold (the default)
 *   CUSUM            the lower CUSUM of velocity has crossed h (decline) or h / 2 (watch)
 *
 * Called only for gated-in contributions; `state` is the state after this one.
 */
export function alertFor(state: TargetState, velocity: number, config: ScoringConfig = DEFAULT_CONFIG): AlertSeverity | null {
  switch (config.alertRule) {
    case 'SINGLE':
      if (velocity <= config.declineVelocity) return 'decline'
      if (velocity <= config.watchVelocity) return 'watch'
      return null
    case 'TWO_CONSECUTIVE':
      if (state.runDecline >= 2) return 'decline'
      if (state.runWatch >= 2) return 'watch'
      return null
    case 'CUSUM':
      if (state.cusum >= config.cusumH) return 'decline'
      if (state.cusum >= config.cusumH / 2) return 'watch'
      return null
  }
}

/* ----------------------------------------------------------- helpers */

export function mean(xs: readonly number[]): number {
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

/** Sample standard deviation (n − 1). */
export function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let ss = 0
  for (const x of xs) ss += (x - m) * (x - m)
  return Math.sqrt(ss / (xs.length - 1))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
