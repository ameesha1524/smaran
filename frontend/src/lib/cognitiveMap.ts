/**
 * The cognitive map: which game reads which domain, and what a session
 * measured.
 *
 * What a session said is not decided here any more: each game's module
 * (games/modules) scores its own trials into contributions, and the scoring
 * engine in lib/scoring folds them in, the single path for every game. What
 * remains is the routing's view of the games, and the weakest-domain rule.
 *
 * Mirrored in backend/src/main/java/org/smaran/service/CognitiveMap.java. The
 * reading *builders* below are device-only — they need round data the server
 * never sees — but the tables, defaults and the weakest-domain rule exist in
 * both places and must stay identical.
 */

import type { DomainReadings, Domain, GameType } from './types'

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

/* ----------------------------------------------------------- helpers */

