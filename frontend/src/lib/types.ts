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
  /** The readings the profile was updated from — resolved, never absent once sent. */
  domainReadings?: DomainReadings
  /** Game-specific raw measures (span history, reaction times…) for the caregiver view. */
  metrics?: Record<string, unknown>
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
  /**
   * What this session measured, domain by domain. Games with round-level data
   * (Duck Roll Call, Koi Are Jumping, Lotus Frog) fill this in themselves;
   * when it is absent, lib/cognitiveMap.ts reads `completionRate` against the
   * game's primary domain.
   */
  domainReadings?: DomainReadings
  metrics?: Record<string, unknown>
}

/* ------------------------------------------------------------- pairing */

/** A one-time code the family reads out to set up her tablet. */
export interface PairingCode {
  /** Formatted for reading aloud: `ABCD-EFGH`. */
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

export interface RedeemResult {
  deviceToken: string
  deviceId: string
  patientId: string
  expiresAt: string
  patient: Patient & { cognitiveProfile?: CognitiveProfile }
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
