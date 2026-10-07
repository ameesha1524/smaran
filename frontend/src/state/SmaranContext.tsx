import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CognitiveProfile,
  GameRoute,
  GardenState,
  JournalEntry,
  LanguageCode,
  MoodKey,
  MotorTier,
  Patient,
  RedeemResult,
  SentimentSignals,
  SessionResultDraft,
  VoiceNote,
} from '../lib/types'
import { cacheGet, cacheSet, queueDepth } from '../lib/db'
import {
  garden as gardenApi,
  games as gamesApi,
  lastSynced,
  patients,
  reminders as remindersApi,
  setTokens,
  submitSession,
  syncNow,
} from '../lib/api'
import { applyRest, emptyGarden, phaseFor, water } from '../lib/gardenEngine'
import { deriveGameRoute, emptyProfile, tapTargetFor, updateProfile } from '../lib/cognitiveProfile'
import { readingsFor, type ReadingHistoryEntry } from '../lib/cognitiveMap'
import { DEMO_PATIENT_ID, demoPatient } from '../lib/demoData'
import { cue, setTone, startAmbient, unlockAudio } from '../lib/ambient'
import { getPack } from '../i18n/strings'
import type { DayPhase } from '../scenes/Sanctuary'

/**
 * One context holds everything the sanctuary needs to be itself: who she is,
 * what language she is greeted in, how the garden is doing, and what today's
 * route looks like. Screens read from here; nothing screen-level fetches twice.
 */

interface SmaranState {
  patient: Patient
  profile: CognitiveProfile
  gardenState: GardenState
  route: GameRoute
  language: LanguageCode
  moodToday: MoodKey | null
  phase: DayPhase
  tapTarget: number
  online: boolean
  pending: number
  syncedAt: number | null
  /**
   * The hand, as the profile currently reads it. Sized tap targets and the
   * journal's default input mode both hang off this.
   */
  motorTier: MotorTier
  /** Has a caregiver ever set this device up? Nothing patient-facing runs before this. */
  caregiverSetupComplete: boolean
  /** Has she confirmed the caregiver's language choice? Asked once, ever. */
  languageConfirmed: boolean
  /** Completed sessions. The first two are the onboarding, silently. */
  sessionCount: number
  journalEntries: JournalEntry[]
  caregiverVoiceNotes: VoiceNote[]
  stillness: boolean
  /** Set once this tablet has redeemed a family pairing code. Null on an unpaired device. */
  devicePairing: DevicePairingMeta | null
}

/** What the tablet remembers about its own pairing. The token itself lives with the other tokens. */
export interface DevicePairingMeta {
  deviceId: string
  patientId: string
  pairedAt: string
  expiresAt: string
}

interface SmaranActions {
  setLanguage(code: LanguageCode): void
  /** Softly, from the pond overlay or the journal — never a gate. */
  checkIn(mood: MoodKey): Promise<void>
  /** Finish a game: water the garden, update the profile, queue or post. */
  completeSession(result: SessionResultDraft): Promise<{ milestone: boolean }>
  setProfile(profile: CognitiveProfile): void
  setPatient(patch: Partial<Patient>): void
  /** The caregiver hands the device over. Opens the patient side for the first time. */
  completeCaregiverSetup(): void
  /**
   * Take on the patient a redeemed pairing code belongs to: her record, her
   * profile, and the device token. Also completes caregiver setup — the family
   * did that part on their own phone.
   */
  adoptPairing(result: RedeemResult): Promise<void>
  /** She confirms the language she is greeted in. Never unset afterwards. */
  confirmLanguage(code: LanguageCode): void
  addJournalEntry(text: string, signals: SentimentSignals | null): JournalEntry
  markVoiceNoteListened(id: string): void
  setStillness(v: boolean): void
  sync(): Promise<void>
}

type Ctx = SmaranState & SmaranActions

const SmaranCtx = createContext<Ctx | null>(null)

export function useSmaran(): Ctx {
  const ctx = useContext(SmaranCtx)
  if (!ctx) throw new Error('useSmaran must be used inside <SmaranProvider>')
  return ctx
}

const PATIENT_KEY = 'patient'
const PROFILE_KEY = 'profile'
const MOOD_KEY = 'mood.today'
const SETUP_KEY = 'smaran.caregiverSetupComplete'
const LANG_CONFIRMED_KEY = 'smaran.languageConfirmed'
const SESSION_COUNT_KEY = 'smaran.sessionCount'
const JOURNAL_KEY = 'smaran.journal'
const VOICE_NOTES_KEY = 'smaran.voiceNotes'
const STILL_KEY = 'smaran.stillness'
const HISTORY_KEY = 'smaran.readingHistory'
const PAIRING_KEY = 'smaran.devicePairing'

/** Enough for the weakest-domain rule's seven-day window with room to spare. */
const KEEP_HISTORY = 60
const HISTORY_MAX_AGE_MS = 30 * 86_400_000

function readPairing(): DevicePairingMeta | null {
  try {
    const raw = localStorage.getItem(PAIRING_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && typeof (parsed as DevicePairingMeta).deviceId === 'string') {
      return parsed as DevicePairingMeta
    }
    return null
  } catch {
    return null
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** localStorage is a shared surface and can hold anything; never trust its shape. */
function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // A full or blocked store must not take the pond down with it.
  }
}

export function SmaranProvider({ children }: { children: ReactNode }) {
  const [patient, setPatientState] = useState<Patient>(demoPatient)
  const [profile, setProfileState] = useState<CognitiveProfile>(() => emptyProfile(DEMO_PATIENT_ID))
  const [gardenState, setGardenState] = useState<GardenState>(() => emptyGarden(DEMO_PATIENT_ID))
  const [language, setLanguageState] = useState<LanguageCode>(demoPatient.languageCode)
  const [moodToday, setMoodToday] = useState<MoodKey | null>(null)
  const [online, setOnline] = useState<boolean>(() => navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [caregiverSetupComplete, setCaregiverSetupComplete] = useState(
    () => localStorage.getItem(SETUP_KEY) === 'true',
  )
  const [languageConfirmed, setLanguageConfirmed] = useState(
    () => localStorage.getItem(LANG_CONFIRMED_KEY) === 'true',
  )
  const [sessionCount, setSessionCount] = useState(() => {
    const n = Number(localStorage.getItem(SESSION_COUNT_KEY))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  })
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() =>
    readList<JournalEntry>(JOURNAL_KEY),
  )
  const [caregiverVoiceNotes, setCaregiverVoiceNotes] = useState<VoiceNote[]>(() =>
    readList<VoiceNote>(VOICE_NOTES_KEY),
  )
  const [stillness, setStillnessState] = useState(() => localStorage.getItem(STILL_KEY) === 'true')
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryEntry[]>(() =>
    readList<ReadingHistoryEntry>(HISTORY_KEY),
  )
  const [devicePairing, setDevicePairing] = useState<DevicePairingMeta | null>(readPairing)
  const ambientStarted = useRef(false)

  // completeSession is often called from a game's unmount cleanup, holding a
  // closure from several renders back. The profile and garden it builds on
  // must be the latest, not the one that closure saw.
  const profileRef = useRef(profile)
  profileRef.current = profile
  const gardenRef = useRef(gardenState)
  gardenRef.current = gardenState

  /* ---------------------------------------------------------- hydrate */

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Local cache first so the pond is on screen before any request resolves.
      const [cachedPatient, cachedProfile, cachedMood] = await Promise.all([
        cacheGet<Patient>(PATIENT_KEY),
        cacheGet<CognitiveProfile>(PROFILE_KEY),
        cacheGet<{ day: string; mood: MoodKey }>(MOOD_KEY),
      ])
      if (!alive) return
      if (cachedPatient) {
        setPatientState(cachedPatient)
        setLanguageState(cachedPatient.languageCode)
      }
      if (cachedProfile) setProfileState(cachedProfile)
      if (cachedMood?.day === todayKey()) setMoodToday(cachedMood.mood)

      const id = cachedPatient?.id ?? demoPatient.id
      const localGarden = await cacheGet<GardenState>(`garden:${id}`)
      if (alive && localGarden) setGardenState(applyRest(localGarden))

      // Then the server, if it is there at all.
      const fresh = await patients.profile(id).catch(() => undefined)
      if (alive && fresh) {
        setPatientState(fresh)
        setLanguageState(fresh.languageCode)
        if (fresh.cognitiveProfile) setProfileState(fresh.cognitiveProfile)
      }
      const g = await gardenApi.state(id).catch(() => undefined)
      if (alive && g) setGardenState(applyRest(g))
      setPending(await queueDepth())
      setSyncedAt(await lastSynced(id))
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ------------------------------------------------------ connectivity */

  useEffect(() => {
    const up = () => {
      setOnline(true)
      void doSync()
    }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id])

  const doSync = useCallback(async () => {
    const outcome = await syncNow(patient.id)
    setPending(await queueDepth())
    if (outcome.ok) setSyncedAt(Date.now())
  }, [patient.id])

  /* ------------------------------------------------------------ route */

  // sessionCount is part of the route because the first two sessions *are* the
  // onboarding: fixed games, fixed difficulty, no screen sat through.
  const route: GameRoute = useMemo(
    () => deriveGameRoute({ profile, moodToday, sessionCount, history: readingHistory }),
    [profile, moodToday, sessionCount, readingHistory],
  )

  // The tap target is global: one number, set by the hand, honoured everywhere.
  useEffect(() => {
    document.documentElement.style.setProperty('--tap-target', `${tapTargetFor(profile.motorTier)}px`)
  }, [profile.motorTier])

  const phase: DayPhase = useMemo(() => phaseFor(gardenState), [gardenState])

  /* ---------------------------------------------------------- actions */

  const setLanguage = useCallback(
    (code: LanguageCode) => {
      setLanguageState(code)
      const next = { ...patient, languageCode: code }
      setPatientState(next)
      void cacheSet(PATIENT_KEY, next)
      void patients.update(patient.id, { languageCode: code }).catch(() => undefined)
    },
    [patient],
  )

  const checkIn = useCallback(
    async (mood: MoodKey) => {
      // The first tap of the day is also the gesture that lets audio start.
      await unlockAudio()
      if (!ambientStarted.current) {
        startAmbient(route.ambientHz, getPack(language).ambientInstrument)
        ambientStarted.current = true
      }
      cue('pond-tap')
      setMoodToday(mood)
      await cacheSet(MOOD_KEY, { day: todayKey(), mood })
    },
    [language, route.ambientHz],
  )

  const completeSession = useCallback(
    async (result: SessionResultDraft): Promise<{ milestone: boolean }> => {
      const outcome = water(gardenRef.current, result.gameType, result.completionRate)
      gardenRef.current = outcome.next
      setGardenState(outcome.next)
      await cacheSet(`garden:${patient.id}`, outcome.next)

      // Resolved once, here, and sent as-is: the server folds in exactly the
      // readings the device did, so the two profiles cannot diverge.
      const readings = readingsFor(result)
      const nextProfile = updateProfile(profileRef.current, { ...result, domainReadings: readings })
      profileRef.current = nextProfile
      setProfileState(nextProfile)
      await cacheSet(PROFILE_KEY, nextProfile)

      setReadingHistory((prev) => {
        const cutoff = Date.now() - HISTORY_MAX_AGE_MS
        const next = [...prev.filter((h) => h.at > cutoff), { at: result.startedAt, readings }].slice(-KEEP_HISTORY)
        writeList(HISTORY_KEY, next)
        return next
      })

      const { queued } = await submitSession({
        patientId: patient.id,
        gameType: result.gameType,
        startedAt: new Date(result.startedAt).toISOString(),
        durationMs: result.durationMs,
        completionRate: result.completionRate,
        difficultyTier: result.difficultyTier,
        cognitiveLoadScore: result.cognitiveLoadScore,
        moodAtStart: result.moodAtStart,
        objectResults: result.objectResults,
        domainReadings: readings,
        metrics: result.metrics,
      })
      // Watering is posted separately so the family WebSocket fires even when
      // the session row is the thing that failed to send.
      void gardenApi.water(patient.id, result.gameType)
      if (queued) setPending(await queueDepth())

      setSessionCount((n) => {
        const next = n + 1
        localStorage.setItem(SESSION_COUNT_KEY, String(next))
        return next
      })

      cue(outcome.milestone ? 'bloom' : 'petal')
      return { milestone: outcome.milestone }
    },
    [patient.id],
  )

  const setProfile = useCallback((p: CognitiveProfile) => {
    setProfileState(p)
    void cacheSet(PROFILE_KEY, p)
  }, [])

  const setPatient = useCallback(
    (patch: Partial<Patient>) => {
      const next = { ...patient, ...patch }
      setPatientState(next)
      if (patch.languageCode) setLanguageState(patch.languageCode)
      void cacheSet(PATIENT_KEY, next)
      void patients.update(patient.id, patch).catch(() => undefined)
    },
    [patient],
  )

  const confirmLanguage = useCallback(
    (code: LanguageCode) => {
      localStorage.setItem(LANG_CONFIRMED_KEY, 'true')
      setLanguageConfirmed(true)
      setLanguage(code)
    },
    [setLanguage],
  )

  const completeCaregiverSetup = useCallback(() => {
    localStorage.setItem(SETUP_KEY, 'true')
    setCaregiverSetupComplete(true)
  }, [])

  const adoptPairing = useCallback(
    async (result: RedeemResult) => {
      // A device token never refreshes: it is long-lived by design, and the
      // family revokes it rather than it expiring under her.
      setTokens(result.deviceToken)

      const { cognitiveProfile, ...record } = result.patient
      setPatientState(record)
      setLanguageState(record.languageCode)
      await cacheSet(PATIENT_KEY, record)
      if (cognitiveProfile) {
        profileRef.current = cognitiveProfile
        setProfileState(cognitiveProfile)
        await cacheSet(PROFILE_KEY, cognitiveProfile)
      }

      const meta: DevicePairingMeta = {
        deviceId: result.deviceId,
        patientId: result.patientId,
        pairedAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      }
      localStorage.setItem(PAIRING_KEY, JSON.stringify(meta))
      setDevicePairing(meta)
      completeCaregiverSetup()
    },
    [completeCaregiverSetup],
  )

  const addJournalEntry = useCallback((text: string, signals: SentimentSignals | null): JournalEntry => {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      text,
      timestamp: Date.now(),
      sentimentSignals: signals,
    }
    setJournalEntries((prev) => {
      const next = [...prev, entry]
      writeList(JOURNAL_KEY, next)
      return next
    })
    return entry
  }, [])

  const markVoiceNoteListened = useCallback((id: string) => {
    setCaregiverVoiceNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, listened: true } : n))
      writeList(VOICE_NOTES_KEY, next)
      return next
    })
  }, [])

  const setStillness = useCallback((v: boolean) => {
    setStillnessState(v)
    localStorage.setItem(STILL_KEY, String(v))
  }, [])

  /* ------------------------------------------ ambient follows the route */

  useEffect(() => {
    if (ambientStarted.current) setTone(route.ambientHz)
  }, [route.ambientHz])

  /* ------------------------------ warm the route cache for offline use */

  useEffect(() => {
    void gamesApi.route(patient.id).catch(() => undefined)
  }, [patient.id])

  /* --------------------------------------- hand the reminders to the SW */

  useEffect(() => {
    let alive = true
    ;(async () => {
      const list = await remindersApi.schedule(patient.id).catch(() => undefined)
      if (!alive) return
      const reg = await navigator.serviceWorker?.ready.catch(() => undefined)
      // The worker needs her name and her sundowning flag, not just the times:
      // it composes the spoken line itself when the page is not running.
      reg?.active?.postMessage({
        type: 'SCHEDULE_REMINDERS',
        reminders: list ?? [],
        kinshipTerm: patient.kinshipTerm,
        languageCode: patient.languageCode,
        sundowning: profile.sundowningPattern,
      })
    })()
    return () => {
      alive = false
    }
  }, [patient.id, patient.kinshipTerm, patient.languageCode, profile.sundowningPattern])

  /* ---------------------------------- the worker asking the page to sync */

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === 'SYNC_NOW') void doSync()
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [doSync])

  const value: Ctx = {
    patient,
    profile,
    gardenState,
    route,
    language,
    moodToday,
    phase,
    tapTarget: tapTargetFor(profile.motorTier),
    online,
    pending,
    syncedAt,
    motorTier: profile.motorTier,
    caregiverSetupComplete,
    languageConfirmed,
    sessionCount,
    journalEntries,
    caregiverVoiceNotes,
    stillness,
    devicePairing,
    setLanguage,
    checkIn,
    completeSession,
    setProfile,
    setPatient,
    completeCaregiverSetup,
    adoptPairing,
    confirmLanguage,
    addJournalEntry,
    markVoiceNoteListened,
    setStillness,
    sync: doSync,
  }

  return <SmaranCtx.Provider value={value}>{children}</SmaranCtx.Provider>
}
