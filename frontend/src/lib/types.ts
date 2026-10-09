import type { ScoreContribution, ScoringState } from './scoring/types'

/**
 * Shared domain types. These mirror the Spring Boot entities one-for-one so
 * that a payload can move between IndexedDB, the API and the UI unchanged.
 */

export type LanguageCode = 'en' | 'as' | 'mni' | 'lus' | 'hi' | 'nag' | (string & {})

export type GameType =
  | 'DUCK_ROLL_CALL'
  | 'GRANDMOTHERS_TALE'
  | 'FAMILY_GROVE'
  | 'MORNING_RITUALS'
  | 'LOTUS_FROG'
  | 'KOI_ARE_JUMPING'

export type MotorTier = 'FLUID' | 'MODERATE' | 'SUPPORTED'

export type SemanticCluster = 'MUSICAL' | 'NATURE' | 'DAILY_LIFE' | 'CRAFT' | 'FOOD'

export type GrovePhase = 1 | 2 | 3 | 4

/** Warm words only. No clinical labels reach the patient's eyes. */
export type MoodKey =
  | 'JOYFUL'
  | 'PEACEFUL'
  | 'QUIET'
  | 'SLEEPY'
  | 'A_LITTLE_LOW'
  | 'WORRIED'
  | 'RESTLESS'
  | 'THINKING'

export type PeakWindow =
  | 'EARLY_MORNING'
  | 'MORNING'
  | 'MIDDAY'
  | 'AFTERNOON'
  | 'EVENING'
  | 'NIGHT'

export interface Patient {
  id: string
  name: string
  languageCode: LanguageCode
  /** How the patient is addressed — Aaita, Ima, Pui. Set by the caregiver, never guessed. */
  kinshipTerm: string
  region: string
  faith?: string
  peakWindow: PeakWindow
  profileVersion: string
  caregiverId?: string
}

export interface DomainScores {
  language: number
  visualSemantic: number
  motor: number
  affective: number
  temporal: number
  /**
   * Domain 6 — Executive Function & Working Memory. Covers visuospatial
   * working memory span (read by Duck Roll Call) and, longer-term, cognitive
   * flexibility / set-shifting (a separate task-switching game, not yet built).
   */
  executiveFunction: number
}

export type Domain = keyof DomainScores

/**
 * What one session says about one domain.
 *
 * `score` is 0–1, how well that domain did this session. `confidence` is 0–1,
 * how much evidence the session produced for it — a two-round sitting or a
 * mostly idle pond visit is a thin reading, and moves the profile less.
 */
export interface DomainReading {
  score: number
  confidence: number
}

/** A session reads the domains it actually exercises, and only those. */
export type DomainReadings = Partial<Record<Domain, DomainReading>>

export interface CognitiveProfile {
  patientId: string
  /**
   * 0–1 per domain. A view of `scoring` for routing and the current dashboard:
   * each value is the engine's level divided by 100.
   */
  domainScores: DomainScores
  /**
   * The scoring engine's state (lib/scoring): level, recent raws and alert
   * bookkeeping per domain and sub-signal. Absent on profiles saved before the
   * engine existed; it is then seeded from `domainScores`.
   */
  scoring?: ScoringState
  motorTier: MotorTier
  /** Derived behaviourally from hesitation and abandonment — never self-reported. */
  anxietyThreshold: number
  startingPhase: GrovePhase
  /** Set when late-afternoon mood consistently dips; silences reminders after 16:00. */
  sundowningPattern: boolean
  /** Per-cluster recognition accuracy, 0–1, rolling. */
  clusterAccuracy: Partial<Record<SemanticCluster, number>>
  selfReportedPeak: PeakWindow
  derivedPeak?: PeakWindow
  updatedAt: string
}

export interface CognitiveObjectResult {
  objectName: string
  semanticCluster: SemanticCluster
  tappedMs: number
  wasCorrect: boolean
}

export interface FamilyMember {
  id: string
  patientId: string
  name: string
  relationship: string
  /** What the patient calls this person, in their own tongue. */
  kinshipTermLocal: string
  photoUrl?: string
  voiceNoteUrl?: string
  contextHint: string
  currentPhase: GrovePhase
}

export interface GardenState {
  patientId: string
  /** 1 bare soil · 2 bamboo shoots · 3 orchids · 4 full grove */
  bloomStage: 1 | 2 | 3 | 4
  growthPoints: number
  /** Moonlight sleep. Not a penalty, not a wilting, not a guilt. */
  restingPhase: boolean
  lastActivity: string
  bloomCount: number
}

export interface MeaningfulObject {
  id: string
  patientId: string
  name: string
  semanticCluster: SemanticCluster
  imageUrl?: string
  /** Fallback glyph when the caregiver has not uploaded a photo yet. */
  glyph?: string
}

export interface ReminderSchedule {
  id: string
  patientId: string
  type: 'MEDICINE' | 'HYDRATION' | 'APPOINTMENT'
  /** "HH:mm" local. */
  scheduledTime: string
  photoUrl?: string
  messageTemplate: string
  languageCode: LanguageCode
}

export interface AcousticVector {
  patientId: string
  sessionId?: string
  capturedAt: string
  jitter: number
  shimmer: number
  pauseDurationAvg: number
  speechRate: number
  phonationRatio: number
}

export interface GameRoute {
  patientId: string
  /** Ordered. First entry is what the sanctuary opens into. */
  games: GameType[]
  difficultyTier: number
  /** 432 calm · 528 emotional grounding. */
  ambientHz: 432 | 528
  tapTargetPx: number
  withinPeakWindow: boolean
  /** Why this route was chosen — shown to caregivers, never to the patient. */
  rationale: string[]
}

/**
 * What a game hands `completeSession` when she finishes. The pipeline turns it
 * into a SessionEnvelope: it scores the trials with the game's module, folds the
 * contributions into the local profile, queues the envelope and syncs it.
 */
export interface SessionResultDraft {
  gameType: GameType
  /** Epoch milliseconds. */
  startedAt: number
  durationMs: number
  /** 0–1: how much of the sitting she did. Waters the garden on the device; it is not a score. */
  completionRate: number
  /** Defaults to `completionRate >= 0.95`. */
  completed?: boolean
  /** She left in the middle of a round. */
  abandoned?: boolean
  difficultyTier: number
  difficultyParams?: Record<string, number | string>
  cognitiveLoadScore: number
  moodAtStart: MoodKey
  /**
   * The raw trials, in the game's own shape (see its module in games/modules).
   * They are scored on the device, stored by the server, and never shown to
   * anyone. A game with none is read from its completion rate at low confidence.
   */
  trials?: unknown[]
  /** Only for a game that scores itself (the Lotus Frog); sent as it is. */
  contributions?: ScoreContribution[]
}

/* ------------------------------------------------------------- pairing */

/** A one-time code the family reads out to set up her tablet. */
export interface PairingCode {
  /** Formatted for reading aloud: `HJ4K-2M`. */
  code: string
  expiresAt: string
}

/** A tablet that redeemed a code and still holds a live device token. */
export interface PairedDevice {
  id: string
  label: string | null
  pairedAt: string
  lastSeenAt: string | null
  expiresAt: string
}

/** The least a tablet is told when it pairs: a first name, a language, how she is addressed. */
export interface DeviceBundle {
  patientId: string
  firstName: string
  languageCode: LanguageCode
  kinshipTerm: string
}

export interface RedeemResult {
  deviceToken: string
  deviceId: string
  patient: DeviceBundle
}

/** What a paired tablet may know of its own patient. A first name only; no surname, no owner. */
export interface DeviceMe extends DeviceBundle {
  region?: string
  peakWindow: PeakWindow
  profileVersion: string
  cognitiveProfile?: CognitiveProfile
}

/**
 * What the model reads back out of a journal entry.
 *
 * Deliberately not a diagnosis. Valence and arousal are dimensions a caregiver
 * can watch drift over weeks; `concernFlags` is the only part that ever raises
 * anything, and it raises it to the caregiver, never to the patient.
 */
export interface SentimentSignals {
  /** -1 bleak · 0 even · 1 bright. */
  valence: number
  /** 0 settled · 1 agitated. */
  arousal: number
  /** Recurring subjects in her own words — "the garden", "my son". */
  themes: string[]
  concernFlags: ('CONFUSION' | 'DISTRESS' | 'LONELINESS' | 'PAIN')[]
  /** One warm sentence, written for the caregiver's eyes. */
  summary: string
}

export interface JournalEntry {
  id: string
  text: string
  timestamp: number
  /** Null while the analysis is in flight, or if it failed — the entry still stands. */
  sentimentSignals: SentimentSignals | null
}

export interface VoiceNote {
  id: string
  audioUrl: string
  timestamp: number
  listened: boolean
  /** Who left it, in the word she knows them by. */
  fromKinshipTerm?: string
}

/* ------------------------------------------------------------ dashboards */

export interface DomainCard {
  /** `LANGUAGE`, `EXECUTIVE` ... or a sub-signal like `WORKING_MEMORY_SPAN`. */
  target: string
  label: string
  /** 0–100: the engine's running level. */
  level: number
  status: 'stable' | 'watch' | 'decline' | 'improving'
  velocity: number
  /** 0–1. Until about a dozen readings, a status is shown as stable whatever it says. */
  confidence: number
  observations: number
  /** The levels after her last few sessions, oldest first. */
  spark: number[]
}

export interface AlertView {
  id: string
  kind: 'DOMAIN_DECLINE' | 'MISSED_DAYS' | 'SUNDOWNING' | string
  target: string
  severity: 'watch' | 'decline' | 'info'
  message: string
  openedAt: string
  lastSeenAt: string
  resolvedAt: string | null
  acknowledgedAt: string | null
}

export interface GameInfo {
  id: string
  title: string
  primaryDomains: string[]
  retired: boolean
}

export interface DashboardView {
  patient: { id: string; name: string; kinshipTerm: string; languageCode: string }
  /** A doctor's view is the same without the family around her. */
  doctorView: boolean
  garden: GardenState
  sessionsLast7Days: number
  lastActive: string | null
  domains: DomainCard[]
  subSignals: DomainCard[]
  markers: { workingMemorySpan: number | null; inhibitionBreakdownTier: number | null; trajectoryPrecisionMs: number | null } | null
  alerts: AlertView[]
  moodTrend: { date: string; mood: MoodKey }[]
  heatmap: { date: string; minutes: number }[]
  acousticTrend: { date: string; jitter: number; shimmer: number }[]
  familyPhases: { id: string; name: string; phase: GrovePhase }[]
  /** Sittings by weekday (0 = Monday) and hour, over 90 days. Empty cells are left out. */
  activity: { weekday: number; hour: number; sessions: number }[]
  games: GameInfo[]
}

/** One journal entry as signals: how warm (-1 to 1), how agitated (0 to 1), and any concern flags. */
export interface SentimentPoint {
  at: string
  valence: number
  arousal: number
  concernFlags: string[]
}

export interface TimePoint {
  at: string
  levels: Record<string, number>
  statuses: Record<string, string>
}

export interface SessionRow {
  id: string
  startedAt: string
  gameId: string | null
  gameTitle: string
  durationMs: number
  completed: boolean
  abandoned: boolean
  difficultyTier: number
  moodAtStart: string | null
  contributions: { target: string; raw: number; confidence: number; because: string }[]
  /** `device` until the server has scored the raw trials itself and agreed. */
  scoringTrust: 'device' | 'server'
}
