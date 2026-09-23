/**
 * The cognitive profile and the routing it drives.
 *
 * The profile is a living document, not a form. Onboarding writes v1.0 without
 * asking a single clinical question; every session after that amends it.
 *
 * This module is deliberately a mirror of CognitiveProfileService.java. The
 * device must be able to route a session with no server, and the two
 * implementations must not drift — if you change a rule here, change it there.
 */

import type {
  CognitiveObjectResult,
  CognitiveProfile,
  DomainScores,
  GameRoute,
  GameType,
  GrovePhase,
  MoodKey,
  MotorTier,
  PeakWindow,
  SemanticCluster,
  SessionResultDraft,
} from './types'

/* ----------------------------------------------------------- peak windows */

const PEAK_HOURS: Record<PeakWindow, [number, number]> = {
  EARLY_MORNING: [5, 8],
  MORNING: [8, 11],
  MIDDAY: [11, 14],
  AFTERNOON: [14, 17],
  EVENING: [17, 20],
  NIGHT: [20, 23],
}

export const PEAK_LABELS: Record<PeakWindow, { name: string; sub: string; glyph: string }> = {
  EARLY_MORNING: { name: 'Early morning', sub: '5 – 8 in the morning', glyph: '🌄' },
  MORNING: { name: 'Morning', sub: '8 – 11 in the morning', glyph: '🌤' },
  MIDDAY: { name: 'Midday', sub: '11 – 2 in the afternoon', glyph: '☀️' },
  AFTERNOON: { name: 'Afternoon', sub: '2 – 5 in the afternoon', glyph: '🌾' },
  EVENING: { name: 'Evening', sub: '5 – 8 in the evening', glyph: '🌇' },
  NIGHT: { name: 'Night', sub: 'after 8 in the evening', glyph: '🌙' },
}

export function withinPeak(window: PeakWindow, now = new Date()): boolean {
  const [from, to] = PEAK_HOURS[window]
  const h = now.getHours()
  // A generous hour of grace either side — the point is her rhythm, not a gate.
  return h >= from - 1 && h < to + 1
}

export function windowForHour(hour: number): PeakWindow {
  const entry = (Object.entries(PEAK_HOURS) as [PeakWindow, [number, number]][]).find(
    ([, [from, to]]) => hour >= from && hour < to,
  )
  return entry?.[0] ?? 'NIGHT'
}

/* -------------------------------------------------------------- motor tier */

/**
 * Fluid ±150 ms · Moderate ±400 ms · Supported (erratic or abandoned).
 * Tap targets grow as the tier descends; they never shrink below 60 px.
 */
export function motorTierFor(offsets: number[], abandoned: boolean): MotorTier {
  if (abandoned || offsets.length < 4) return 'SUPPORTED'
  const absMean = offsets.reduce((a, b) => a + Math.abs(b), 0) / offsets.length
  if (absMean <= 150) return 'FLUID'
  if (absMean <= 400) return 'MODERATE'
  return 'SUPPORTED'
}

export function tapTargetFor(tier: MotorTier): number {
  return { FLUID: 60, MODERATE: 76, SUPPORTED: 96 }[tier]
}

/** Timing-based mechanics are simply switched off for a supported hand. */
export function timingMechanicsAllowed(tier: MotorTier): boolean {
  return tier !== 'SUPPORTED'
}

/** Rising tap variance week over week is a motor signal, kept apart from cognition. */
export function motorVarianceSpike(weekly: number[]): boolean {
  if (weekly.length < 3) return false
  const prior = weekly.slice(0, -1)
  const last = weekly[weekly.length - 1]
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length
  return avg > 0 && last > avg * 1.4
}

/* --------------------------------------------------------------- affect */

const LOW_MOODS: MoodKey[] = ['A_LITTLE_LOW', 'WORRIED', 'RESTLESS']

export function isLowMood(mood: MoodKey | null | undefined): boolean {
  return !!mood && LOW_MOODS.includes(mood)
}

/**
 * Sundowning: mood dips concentrated in the late afternoon. When set, no game
 * reminder is scheduled after 16:00 for this patient.
 */
export function detectSundowning(log: { at: string; mood: MoodKey }[]): boolean {
  const late = log.filter((e) => {
    const h = new Date(e.at).getHours()
    return h >= 15 && h <= 19
  })
  if (late.length < 4) return false
  const lowLate = late.filter((e) => isLowMood(e.mood)).length / late.length
  const others = log.filter((e) => {
    const h = new Date(e.at).getHours()
    return h < 15 || h > 19
  })
  const lowOther = others.length ? others.filter((e) => isLowMood(e.mood)).length / others.length : 0
  return lowLate >= 0.55 && lowLate > lowOther + 0.2
}

export function remindersAllowedAt(profile: CognitiveProfile, hour: number): boolean {
  return !(profile.sundowningPattern && hour >= 16)
}

/**
 * Anxiety threshold, derived behaviourally and never self-reported. Hesitation,
 * mid-session pauses, replayed voice hints and abandonment all push it down;
 * a lower threshold means difficulty eases sooner.
 */
export function deriveAnxietyThreshold(signals: {
  medianHesitationMs: number
  replayCount: number
  abandonedSessions: number
  totalSessions: number
}): number {
  const { medianHesitationMs, replayCount, abandonedSessions, totalSessions } = signals
  let threshold = 0.72
  if (medianHesitationMs > 4000) threshold -= 0.12
  else if (medianHesitationMs > 2500) threshold -= 0.06
  if (replayCount > 3) threshold -= 0.05
  if (totalSessions > 0 && abandonedSessions / totalSessions > 0.2) threshold -= 0.12
  return Math.max(0.35, Math.min(0.85, Number(threshold.toFixed(2))))
}

/* --------------------------------------------------- visual-semantic map */

export function clusterAccuracy(results: CognitiveObjectResult[]): Partial<Record<SemanticCluster, number>> {
  const acc: Partial<Record<SemanticCluster, { hit: number; n: number }>> = {}
  for (const r of results) {
    const c = (acc[r.semanticCluster] ??= { hit: 0, n: 0 })
    c.n += 1
    if (r.wasCorrect) c.hit += 1
  }
  const out: Partial<Record<SemanticCluster, number>> = {}
  for (const [k, v] of Object.entries(acc) as [SemanticCluster, { hit: number; n: number }][]) {
    out[k] = Number((v.hit / v.n).toFixed(3))
  }
  return out
}

/**
 * A cluster falling while the others hold is a declining memory *domain* — not
 * declining cultural knowledge. That distinction is the whole point of tracking
 * per cluster rather than per game.
 */
export function decliningCluster(
  history: { at: string; accuracy: Partial<Record<SemanticCluster, number>> }[],
): { cluster: SemanticCluster; from: number; to: number } | null {
  if (history.length < 3) return null
  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at))
  const first = sorted[0].accuracy
  const last = sorted[sorted.length - 1].accuracy
  let worst: { cluster: SemanticCluster; from: number; to: number } | null = null
  for (const key of Object.keys(last) as SemanticCluster[]) {
    const from = first[key]
    const to = last[key]
    if (from == null || to == null) continue
    const drop = from - to
    if (drop >= 0.2 && (!worst || drop > worst.from - worst.to)) worst = { cluster: key, from, to }
  }
  return worst
}

/* ---------------------------------------------------------------- domains */

/** Which domain fell furthest this week. Drives the second game of the session. */
export function weakestDomain(trend: { date: string; scores: DomainScores }[]): keyof DomainScores | null {
  if (trend.length < 2) return null
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0].scores
  const last = sorted[sorted.length - 1].scores
  let key: keyof DomainScores | null = null
  let worst = 0
  for (const k of Object.keys(last) as (keyof DomainScores)[]) {
    const delta = first[k] - last[k]
    if (delta > worst) {
      worst = delta
      key = k
    }
  }
  return worst >= 0.05 ? key : null
}

const DOMAIN_GAMES: Record<keyof DomainScores, GameType> = {
  language: 'GRANDMOTHERS_TALE',
  visualSemantic: 'WEAVERS_LOOM',
  motor: 'MORNING_RITUALS',
  affective: 'FAMILY_GROVE',
  temporal: 'MORNING_RITUALS',
}

/* ---------------------------------------------------------------- routing */

export interface RouteInputs {
  profile: CognitiveProfile
  moodToday: MoodKey | null
  domainTrend?: { date: string; scores: DomainScores }[]
  now?: Date
}

/**
 * deriveGameRoute — run at every session start.
 *
 *   1. outside the peak window  → low-effort games only
 *   2. mood anxious or low      → Family Grove first, 432 Hz, difficulty −1
 *   3. weakest domain this week → its game goes second
 *   4. motor tier               → filter timing mechanics, set tap size globally
 *   5. per-member Grove phase   → resolved separately, per family member
 */
export function deriveGameRoute({ profile, moodToday, domainTrend = [], now = new Date() }: RouteInputs): GameRoute {
  const rationale: string[] = []
  const inPeak = withinPeak(profile.selfReportedPeak, now)
  let difficultyTier = 2
  let ambientHz: 432 | 528 = 432

  const lowEffort: GameType[] = ['FAMILY_GROVE', 'MORNING_RITUALS']
  let games: GameType[] = ['WEAVERS_LOOM', 'GRANDMOTHERS_TALE', 'FAMILY_GROVE', 'MORNING_RITUALS']

  if (!inPeak) {
    games = games.filter((g) => lowEffort.includes(g))
    difficultyTier -= 1
    rationale.push('Outside the peak window — only low-effort games are offered.')
  }

  if (isLowMood(moodToday)) {
    games = ['FAMILY_GROVE', ...games.filter((g) => g !== 'FAMILY_GROVE')]
    difficultyTier -= 1
    ambientHz = 432
    rationale.push('Mood is low or restless — starting with Family Grove at 432 Hz, one tier easier.')
  } else if (games[0] === 'FAMILY_GROVE') {
    ambientHz = 528
  }

  const weakest = weakestDomain(domainTrend)
  if (weakest) {
    const target = DOMAIN_GAMES[weakest]
    games = [games[0], target, ...games.filter((g) => g !== games[0] && g !== target)]
    rationale.push(`${weakest} declined most this week — its game is scheduled second.`)
  }

  if (!timingMechanicsAllowed(profile.motorTier)) {
    rationale.push('Motor tier is supported — timing-based mechanics are switched off.')
  }

  const tapTargetPx = tapTargetFor(profile.motorTier)
  rationale.push(`Tap targets set to ${tapTargetPx} px for a ${profile.motorTier.toLowerCase()} hand.`)

  return {
    patientId: profile.patientId,
    games,
    difficultyTier: Math.max(1, Math.min(3, difficultyTier)),
    ambientHz,
    tapTargetPx,
    withinPeakWindow: inPeak,
    rationale,
  }
}

/* ------------------------------------------------- the three silent axes */

export interface DifficultyAxes {
  /** 0 none · 1 a nudge · 2 the answer all but spoken. */
  hintRichness: 0 | 1 | 2
  choiceCount: 2 | 3 | 4
  /** 0–1. Lower = slower motion, higher contrast, fewer distractors. */
  visualClarity: number
}

export function axesFor(tier: number): DifficultyAxes {
  switch (Math.max(1, Math.min(3, tier))) {
    case 1:
      return { hintRichness: 2, choiceCount: 2, visualClarity: 1 }
    case 2:
      return { hintRichness: 1, choiceCount: 3, visualClarity: 0.8 }
    default:
      return { hintRichness: 0, choiceCount: 4, visualClarity: 0.62 }
  }
}

/** All three axes move together, and always downward on overload. */
export function ease(axes: DifficultyAxes): DifficultyAxes {
  return {
    hintRichness: Math.min(2, axes.hintRichness + 1) as 0 | 1 | 2,
    choiceCount: Math.max(2, axes.choiceCount - 1) as 2 | 3 | 4,
    visualClarity: Math.min(1, axes.visualClarity + 0.18),
  }
}

/* ---------------------------------------------------- onboarding → v1.0 */

export interface OnboardingSignals {
  patientId: string
  languageCode: string
  /** Time from screen ready to the language tap — a language-domain signal. */
  languageLatencyMs: number
  objectResults: CognitiveObjectResult[]
  rhythmOffsets: number[]
  rhythmAbandoned: boolean
  mood: MoodKey
  peakWindow: PeakWindow
}

/** Writes profile v1.0 without asking the patient a single clinical question. */
export function buildProfileV1(s: OnboardingSignals): CognitiveProfile {
  const tier = motorTierFor(s.rhythmOffsets, s.rhythmAbandoned)
  const clusters = clusterAccuracy(s.objectResults)
  const objectAccuracy = s.objectResults.length
    ? s.objectResults.filter((r) => r.wasCorrect).length / s.objectResults.length
    : 0.5
  const medianTap = median(s.objectResults.map((r) => r.tappedMs))

  const language = clamp01(1 - s.languageLatencyMs / 20000)
  const motor = { FLUID: 0.85, MODERATE: 0.6, SUPPORTED: 0.4 }[tier]
  const affective = isLowMood(s.mood) ? 0.5 : 0.75

  return {
    patientId: s.patientId,
    domainScores: {
      language: round(language),
      visualSemantic: round(objectAccuracy),
      motor,
      affective,
      // Nothing measures temporal orientation until Morning Rituals runs once;
      // a neutral 0.6 is honest about that rather than inventing a reading.
      temporal: 0.6,
    },
    motorTier: tier,
    anxietyThreshold: deriveAnxietyThreshold({
      medianHesitationMs: medianTap,
      replayCount: 0,
      abandonedSessions: s.rhythmAbandoned ? 1 : 0,
      totalSessions: 1,
    }),
    startingPhase: startingPhaseFor(objectAccuracy),
    sundowningPattern: false,
    clusterAccuracy: clusters,
    selfReportedPeak: s.peakWindow,
    updatedAt: new Date().toISOString(),
  }
}

/** Errorless learning: start where success is near-certain, and climb from there. */
function startingPhaseFor(objectAccuracy: number): GrovePhase {
  if (objectAccuracy >= 0.85) return 2
  return 1
}

/** Applied after every session — the loop that closes the profile. */
export function updateProfile(profile: CognitiveProfile, result: SessionResultDraft): CognitiveProfile {
  const domain = {
    WEAVERS_LOOM: 'visualSemantic',
    GRANDMOTHERS_TALE: 'language',
    FAMILY_GROVE: 'affective',
    MORNING_RITUALS: 'temporal',
  }[result.gameType] as keyof DomainScores

  // Exponential moving average: one bad day never rewrites a person.
  const prior = profile.domainScores[domain]
  const next = round(prior * 0.75 + result.completionRate * 0.25)

  const scores: DomainScores = { ...profile.domainScores, [domain]: next }
  if (result.objectResults?.length) {
    const fresh = clusterAccuracy(result.objectResults)
    for (const [k, v] of Object.entries(fresh) as [SemanticCluster, number][]) {
      const before = profile.clusterAccuracy[k] ?? v
      profile.clusterAccuracy[k] = round(before * 0.7 + v * 0.3)
    }
  }

  return {
    ...profile,
    domainScores: scores,
    derivedPeak: windowForHour(new Date(result.startedAt).getHours()),
    updatedAt: new Date().toISOString(),
  }
}

export function emptyProfile(patientId: string, peak: PeakWindow = 'MORNING'): CognitiveProfile {
  return {
    patientId,
    domainScores: { language: 0.6, visualSemantic: 0.6, motor: 0.6, affective: 0.7, temporal: 0.6 },
    motorTier: 'MODERATE',
    anxietyThreshold: 0.72,
    startingPhase: 1,
    sundowningPattern: false,
    clusterAccuracy: {},
    selfReportedPeak: peak,
    updatedAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------- helpers */

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function round(n: number) {
  return Number(n.toFixed(3))
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
