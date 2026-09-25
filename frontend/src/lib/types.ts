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

export interface CognitiveProfile {
  patientId: string
  domainScores: DomainScores
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

export interface GameSession {
  id?: string
  patientId: string
  gameType: GameType
  startedAt: string
  durationMs: number
  completionRate: number
  difficultyTier: number
  cognitiveLoadScore: number
  moodAtStart: MoodKey
  objectResults?: CognitiveObjectResult[]
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

export interface SessionResultDraft {
  gameType: GameType
  startedAt: number
  durationMs: number
  completionRate: number
  difficultyTier: number
  cognitiveLoadScore: number
  moodAtStart: MoodKey
  objectResults?: CognitiveObjectResult[]
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

export interface DashboardSummary {
  patient: Patient
  garden: GardenState
  sessionsThisWeek: number
  lastActive: string | null
  moodTrend: { date: string; mood: MoodKey }[]
  domainTrend: {
    date: string
    language: number
    visualSemantic: number
    motor: number
    affective: number
    temporal: number
    executiveFunction: number
  }[]
  heatmap: { date: string; minutes: number }[]
  perGame: { gameType: GameType; sessions: number; avgScore: number; trend: 'UP' | 'FLAT' | 'DOWN' }[]
  familyPhases: { id: string; name: string; phase: GrovePhase }[]
  alerts: DashboardAlert[]
  acousticTrend: { date: string; jitter: number; shimmer: number }[]
}

export interface DashboardAlert {
  level: 'ORANGE' | 'AMBER' | 'YELLOW'
  code: 'MISSED_DAYS' | 'LANGUAGE_REGRESSION' | 'MOTOR_VARIANCE' | 'VOICE_BIOMARKER' | 'CLUSTER_DECLINE'
  message: string
}
