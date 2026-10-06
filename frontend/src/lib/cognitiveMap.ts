/**
 * The cognitive map: which game reads which domain, and how a session's
 * reading moves the profile.
 *
 * Every session, from every game, goes through the same two steps:
 *
 *   1. readingsFor(session) — what did this session measure? Games that keep
 *      round-level data build a rich reading themselves (duckReadings,
 *      koiReadings, the Lotus Frog's own report). Every other game is read
 *      as its completion rate against its one primary domain.
 *
 *   2. applyReadings(scores, readings) — fold it in. One exponential moving
 *      average for everything: a domain moves by at most MAX_STEP toward the
 *      new score, scaled by the reading's confidence. At full confidence that
 *      is exactly `prior·0.75 + score·0.25`, the rule every game used before —
 *      so one bad afternoon still never rewrites a person, and a thin reading
 *      (two rounds, a mostly idle visit) only nudges.
 *
 * There are no per-game special cases in the profile update. A game that
 * wants to say more says it through its readings.
 *
 * Mirrored in backend/src/main/java/org/smaran/service/CognitiveMap.java. The
 * reading *builders* below are device-only — they need round data the server
 * never sees — but the tables, defaults, the EMA and the weakest-domain rule
 * exist in both places and must stay identical. The parity vectors at the
 * bottom of this file are asserted by CognitiveMapTest.java.
 */

import type { DomainReadings, DomainScores, Domain, GameType, SessionResultDraft } from './types'

/* ---------------------------------------------------------------- tables */

export const DOMAINS: Domain[] = ['language', 'visualSemantic', 'motor', 'affective', 'temporal', 'executiveFunction']

/** The domain a game is *for*. Its completion rate reads here by default. */
export const PRIMARY_DOMAIN: Record<GameType, Domain> = {
  GRANDMOTHERS_TALE: 'language',
  LOTUS_FROG: 'visualSemantic',
  KOI_ARE_JUMPING: 'motor',
  FAMILY_GROVE: 'affective',
  MORNING_RITUALS: 'temporal',
  DUCK_ROLL_CALL: 'executiveFunction',
}

/** Every domain a game can produce a reading for. Documentation as much as data. */
export const READS: Record<GameType, Domain[]> = {
  GRANDMOTHERS_TALE: ['language'],
  // The pond measures four things at once; language it never touches.
  LOTUS_FROG: ['visualSemantic', 'motor', 'affective', 'temporal'],
  KOI_ARE_JUMPING: ['motor'],
  FAMILY_GROVE: ['affective'],
  MORNING_RITUALS: ['temporal'],
  DUCK_ROLL_CALL: ['executiveFunction'],
}

/** When a domain declines, this is the game that exercises it most directly. */
export const DOMAIN_GAME: Record<Domain, GameType> = {
  language: 'GRANDMOTHERS_TALE',
  visualSemantic: 'LOTUS_FROG',
  motor: 'KOI_ARE_JUMPING',
  affective: 'FAMILY_GROVE',
  temporal: 'MORNING_RITUALS',
  executiveFunction: 'DUCK_ROLL_CALL',
}

/** The day's rotation, before routing reorders or filters it. */
export const ROUTE_GAMES: GameType[] = [
  'DUCK_ROLL_CALL',
  'GRANDMOTHERS_TALE',
  'FAMILY_GROVE',
  'MORNING_RITUALS',
  'KOI_ARE_JUMPING',
  'LOTUS_FROG',
]

/** Offered outside her peak window: nothing to hold in mind, nothing to get wrong. */
export const LOW_EFFORT: GameType[] = ['FAMILY_GROVE', 'MORNING_RITUALS', 'KOI_ARE_JUMPING', 'LOTUS_FROG']

/** Games whose core mechanic is a response window — dropped for a supported hand. */
export const TIMING_GAMES: GameType[] = ['KOI_ARE_JUMPING']

/** The most a single, fully confident session can move a domain. */
export const MAX_STEP = 0.25

/* ------------------------------------------------------------ the update */

/**
 * Keep only what could be real: known domains, finite numbers, clamped to
 * 0–1, and nothing with zero confidence (a reading with no evidence is not a
 * reading). The server applies exactly the same filter to what it receives.
 */
export function sanitizeReadings(input: DomainReadings | undefined | null): DomainReadings {
  const out: DomainReadings = {}
  if (!input) return out
  for (const d of DOMAINS) {
    const r = input[d]
    if (!r || !Number.isFinite(r.score) || !Number.isFinite(r.confidence)) continue
    const confidence = clamp01(r.confidence)
    if (confidence <= 0) continue
    out[d] = { score: round(clamp01(r.score)), confidence: round(confidence) }
  }
  return out
}

/** What a session measured — its own readings if it has them, else its completion rate. */
export function readingsFor(session: Pick<SessionResultDraft, 'gameType' | 'completionRate' | 'domainReadings'>): DomainReadings {
  const own = sanitizeReadings(session.domainReadings)
  if (Object.keys(own).length > 0) return own
  return sanitizeReadings({ [PRIMARY_DOMAIN[session.gameType]]: { score: session.completionRate, confidence: 1 } })
}

/** The one EMA. Domains the session did not read are left exactly as they were. */
export function applyReadings(scores: DomainScores, readings: DomainReadings): DomainScores {
  const next: DomainScores = { ...scores }
  const clean = sanitizeReadings(readings)
  for (const d of DOMAINS) {
    const r = clean[d]
    if (!r) continue
    const alpha = MAX_STEP * r.confidence
    const prior = Number.isFinite(next[d]) ? next[d] : 0.6
    next[d] = round(prior * (1 - alpha) + r.score * alpha)
  }
  return next
}

/* ----------------------------------------------------- weakest domain */

export interface ReadingHistoryEntry {
  /** Epoch ms the session started. */
  at: number
  readings: DomainReadings
}

/**
 * Which domain fell furthest this week — the game for it is scheduled second.
 *
 * Needs at least three sessions in the last seven days and at least two
 * readings of the domain in question; the trend is last minus first, and
 * only a fall of more than 0.05 counts. Blunt, and the right instrument at
 * these sample sizes.
 */
export function weakestDomainFromHistory(history: ReadingHistoryEntry[], now = Date.now()): Domain | null {
  const week = history.filter((h) => h.at > now - 7 * 86_400_000).sort((a, b) => a.at - b.at)
  if (week.length < 3) return null
  let worst: Domain | null = null
  let worstTrend = -0.05
  for (const d of DOMAINS) {
    const series = week.map((h) => h.readings[d]?.score).filter((s): s is number => typeof s === 'number')
    if (series.length < 2) continue
    const trend = series[series.length - 1] - series[0]
    if (trend < worstTrend) {
      worstTrend = trend
      worst = d
    }
  }
  return worst
}

/* ------------------------------------------------- per-game readings */

export interface DuckRound {
  spanLength: number
  flashDurationMs: number
  wasCorrect: boolean
  attemptsBeforeCorrect: number
}

/**
 * Duck Roll Call → executiveFunction.
 *
 * Half accuracy, half the level she was working at. Accuracy alone would
 * score a flawless span-3 round the same as a flawless span-6 one, which is
 * exactly the thing a working-memory span task exists to tell apart. Level
 * is mostly span (3→6) with a little credit for a shorter flash (2000→800 ms).
 *
 * A flawless sitting at the starting level reads 0.5 — deliberately neutral,
 * because span 3 is where everyone starts and it says little about ceiling.
 * Confidence grows with rounds played, full at four.
 */
export function duckReadings(rounds: DuckRound[]): DomainReadings {
  if (rounds.length === 0) return {}
  let total = 0
  for (const r of rounds) {
    const accuracy = r.wasCorrect ? 1 : Math.max(0.3, 1 - 0.15 * r.attemptsBeforeCorrect)
    const span = clamp01((r.spanLength - 3) / 3)
    const speed = clamp01((2000 - r.flashDurationMs) / 1200)
    const level = 0.8 * span + 0.2 * speed
    total += 0.5 * accuracy + 0.5 * level
  }
  return {
    executiveFunction: { score: round(total / rounds.length), confidence: round(Math.min(1, rounds.length / 4)) },
  }
}

export interface KoiRound {
  wasTapped: boolean
  reactionMs: number | null
  leapMs: number
}

/**
 * The Koi Are Jumping → motor.
 *
 * Mostly whether she responded at all (70%), partly how early in the leap
 * (30%): a tap as the creature leaves the water is faster than one as it
 * lands. Speed is read relative to each leap's own air time, since leaps
 * now vary in length. Confidence is full at a complete six-leap sitting.
 */
export function koiReadings(rounds: KoiRound[]): DomainReadings {
  if (rounds.length === 0) return {}
  const tapped = rounds.filter((r) => r.wasTapped && r.reactionMs != null)
  const hitRate = tapped.length / rounds.length
  const speed = tapped.length
    ? tapped.reduce((sum, r) => sum + clamp01(1 - (r.reactionMs as number) / Math.max(1, r.leapMs)), 0) / tapped.length
    : 0
  const score = tapped.length ? 0.7 * hitRate + 0.3 * speed : 0
  return { motor: { score: round(score), confidence: round(Math.min(1, rounds.length / 6)) } }
}

/* ----------------------------------------------------------- helpers */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function round(n: number): number {
  return Number(n.toFixed(3))
}

/**
 * Parity vectors — the Java side asserts these exact numbers.
 *
 *   applyReadings({motor: 0.6, …}, {motor: {score: 1, confidence: 1}})    → motor 0.7
 *   applyReadings({motor: 0.6, …}, {motor: {score: 1, confidence: 0.5}})  → motor 0.65
 *   applyReadings({motor: 0.6, …}, {motor: {score: 0, confidence: 1}})    → motor 0.45
 *   readingsFor({gameType: 'FAMILY_GROVE', completionRate: 0.8})          → affective {0.8, 1}
 *   sanitizeReadings({motor: {score: 1.4, confidence: 2}})                → motor {1, 1}
 */
