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
  submitSession,
  syncNow,
} from '../lib/api'
import { applyRest, emptyGarden, phaseFor, water } from '../lib/gardenEngine'
import { deriveGameRoute, emptyProfile, tapTargetFor, updateProfile } from '../lib/cognitiveProfile'
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
  const ambientStarted = useRef(false)

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
    () => deriveGameRoute({ profile, moodToday, sessionCount }),
    [profile, moodToday, sessionCount],
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
      const outcome = water(gardenState, result.gameType, result.completionRate)
      setGardenState(outcome.next)
      await cacheSet(`garden:${patient.id}`, outcome.next)

      // updateProfile returns the *same* object for games that own their
      // profile update (the Lotus Frog folds in four domains itself, before
      // calling this). Writing it back regardless would overwrite that richer
      // reading with whatever this closure captured.
      const nextProfile = updateProfile(profile, result)
      if (nextProfile !== profile) {
        setProfileState(nextProfile)
        await cacheSet(PROFILE_KEY, nextProfile)
      }

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
    [gardenState, patient.id, profile],
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
    setLanguage,
    checkIn,
    completeSession,
    setProfile,
    setPatient,
    completeCaregiverSetup,
    confirmLanguage,
    addJournalEntry,
    markVoiceNoteListened,
    setStillness,
    sync: doSync,
  }

  return <SmaranCtx.Provider value={value}>{children}</SmaranCtx.Provider>
}
