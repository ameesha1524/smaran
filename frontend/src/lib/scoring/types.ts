/**
 * The shared contract between a game, the device, the server and the
 * data-science code (docs/MASTER_PROMPT.md, Appendix A).
 *
 * Mirrored as Java records in backend/src/main/java/org/smaran/scoring/. The
 * lists and field names here are also written into golden-vectors.json, and
 * tests on both sides fail if either copy drifts from that file.
 */

export const ENGINE_VERSION = '1.0.0'

export const DOMAIN_IDS = ['LANGUAGE', 'VISUAL_SEMANTIC', 'MOTOR', 'AFFECTIVE', 'TEMPORAL', 'EXECUTIVE'] as const
export type DomainId = (typeof DOMAIN_IDS)[number]

export const SUB_SIGNAL_IDS = [
  'WORKING_MEMORY_SPAN',
  'INHIBITORY_CONTROL',
  'COGNITIVE_FLEXIBILITY',
  'TRAJECTORY_PREDICTION',
  'REACTION_SPEED',
  'SUSTAINED_ATTENTION',
] as const
export type SubSignalId = (typeof SUB_SIGNAL_IDS)[number]

export type TargetId = DomainId | SubSignalId
export const TARGET_IDS: readonly TargetId[] = [...DOMAIN_IDS, ...SUB_SIGNAL_IDS]

/** What one session says about one domain or sub-signal. */
export interface ScoreContribution {
  target: TargetId
  /** 0–100, for this session only. */
  raw: number
  /** 0–1. Short or abandoned sessions score low and move the level less. */
  confidence: number
  /** Plain-language reason, shown on the caregiver dashboard. */
  because: string
}

export interface SessionMarkers {
  workingMemorySpan?: number
  inhibitionBreakdownTier?: number
  trajectoryPrecisionMs?: number
}

/** One finished sitting, as it travels from the tablet to the server. */
export interface SessionEnvelope {
  /** UUID generated on the device. */
  clientSessionId: string
  patientId: string
  /** Registry id of the game. */
  gameId: string
  /** ISO-8601. (patientId, startedAt) is the dedupe key. */
  startedAt: string
  durationMs: number
  completed: boolean
  abandoned: boolean
  hourOfDay: number
  moodAtStart: string | null
  difficulty: { tier: number; params: Record<string, number | string> }
  /** Game-specific raw trials. Stored as JSONB; never interpreted by the engine. */
  trials: unknown[]
  contributions: ScoreContribution[]
  markers?: SessionMarkers
  /** True when the game computed its own readings (Lotus Frog). The server replays them and never re-scores. */
  precomputedReading?: boolean
  engineVersion: string
}

/** The field names of SessionEnvelope, in order. Checked against golden-vectors.json. */
export const SESSION_ENVELOPE_FIELDS = [
  'clientSessionId',
  'patientId',
  'gameId',
  'startedAt',
  'durationMs',
  'completed',
  'abandoned',
  'hourOfDay',
  'moodAtStart',
  'difficulty',
  'trials',
  'contributions',
  'markers',
  'precomputedReading',
  'engineVersion',
] as const satisfies readonly (keyof SessionEnvelope)[]

/** A game plugs in by providing one of these and one registry entry. */
export interface GameModule {
  id: string
  title: string
  route: string
  primaryDomains: DomainId[]
  scoreSession(trials: unknown[], ctx: { hourOfDay: number }): ScoreContribution[]
  markers?(trials: unknown[]): SessionMarkers | undefined
}

/* ------------------------------------------------------------ the engine */

export const STATUSES = ['stable', 'watch', 'decline', 'improving'] as const
export type Status = (typeof STATUSES)[number]

export const ALERT_RULES = ['TWO_CONSECUTIVE', 'SINGLE', 'CUSUM'] as const
export type AlertRule = (typeof ALERT_RULES)[number]

export type AlertSeverity = 'watch' | 'decline'

/** Everything the engine remembers about one domain or sub-signal. */
export interface TargetState {
  /** The running level, 0–100. */
  level: number
  /** How many contributions have ever been applied. */
  observations: number
  /** The most recent raws, oldest first, at most `window` of them. */
  raws: number[]
  /** Consecutive gated contributions at or below the watch threshold. */
  runWatch: number
  /** Consecutive gated contributions at or below the decline threshold. */
  runDecline: number
  /** One-sided lower CUSUM of velocity. */
  cusum: number
}

export type ScoringState = Partial<Record<TargetId, TargetState>>

/** What applying one contribution produced. */
export interface Reading {
  target: TargetId
  raw: number
  /** The session's own confidence, after clamping. */
  confidence: number
  level: number
  baseline: number
  sd: number
  velocity: number
  /** min(1, observations / fullConfidenceObservations). */
  domainConfidence: number
  status: Status
  /** Under the configured alert rule. Null when nothing should be raised. */
  alert: AlertSeverity | null
}

export interface ScoringConfig {
  /** alpha = baseAlpha × confidence. */
  baseAlpha: number
  startLevel: number
  /** How many raws the baseline and SD look back over. */
  window: number
  /** Below this many prior raws, the baseline is the level. */
  minBaselineObservations: number
  /** Below this many prior raws, the SD is `priorSd`. */
  minSdObservations: number
  priorSd: number
  /** Floor on the SD, so a run of identical scores cannot produce an infinite velocity. */
  minSd: number
  fullConfidenceObservations: number
  /** Below this domain confidence, status is `stable` and nothing alerts. 0 switches gating off. */
  confidenceGate: number
  declineVelocity: number
  watchVelocity: number
  improvingVelocity: number
  alertRule: AlertRule
  /** CUSUM slack, in SD units. */
  cusumK: number
  /** CUSUM decision threshold. `decline` at h, `watch` at h / 2. */
  cusumH: number
}

export const DEFAULT_CONFIG: ScoringConfig = {
  baseAlpha: 0.25,
  startLevel: 50,
  window: 30,
  minBaselineObservations: 3,
  minSdObservations: 5,
  priorSd: 12,
  minSd: 3,
  fullConfidenceObservations: 12,
  confidenceGate: 0.35,
  declineVelocity: -1.5,
  watchVelocity: -0.8,
  improvingVelocity: 1.0,
  alertRule: 'TWO_CONSECUTIVE',
  cusumK: 0.5,
  cusumH: 4,
}
