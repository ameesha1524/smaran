import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CognitiveProfile,
  GameRoute,
  GardenState,
  LanguageCode,
  MoodKey,
  Patient,
  SessionResultDraft,
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
  /** True until the first mood tap — the gesture that also unlocks audio. */
  needsCheckIn: boolean
  onboarded: boolean
  /** Has anyone told this device who is sitting at the pond? */
  registered: boolean
  /** Has a language flower been chosen on this device? Asked once, ever. */
  languageChosen: boolean
  stillness: boolean
}

interface SmaranActions {
  setLanguage(code: LanguageCode): void
  checkIn(mood: MoodKey): Promise<void>
  /** Finish a game: water the garden, update the profile, queue or post. */
  completeSession(result: SessionResultDraft): Promise<{ milestone: boolean }>
  setProfile(profile: CognitiveProfile): void
  setPatient(patch: Partial<Patient>): void
  /** The one thing the login screen does: give the pond a name to greet. */
  register(name: string, kinshipTerm: string): void
  /** First-launch flower pick. Sets the language and retires the question. */
  chooseLanguage(code: LanguageCode): void
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
const ONBOARDED_KEY = 'smaran.onboarded'
const REGISTERED_KEY = 'smaran.registered'
const LANG_CHOSEN_KEY = 'smaran.languageChosen'
const STILL_KEY = 'smaran.stillness'

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
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
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === 'true')
  const [registered, setRegistered] = useState(() => localStorage.getItem(REGISTERED_KEY) === 'true')
  const [languageChosen, setLanguageChosen] = useState(() => localStorage.getItem(LANG_CHOSEN_KEY) === 'true')
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

  const route: GameRoute = useMemo(
    () => deriveGameRoute({ profile, moodToday }),
    [profile, moodToday],
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

      const nextProfile = updateProfile(profile, result)
      setProfileState(nextProfile)
      await cacheSet(PROFILE_KEY, nextProfile)

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

      cue(outcome.milestone ? 'bloom' : 'petal')
      return { milestone: outcome.milestone }
    },
    [gardenState, patient.id, profile],
  )

  const setProfile = useCallback((p: CognitiveProfile) => {
    setProfileState(p)
    void cacheSet(PROFILE_KEY, p)
    localStorage.setItem(ONBOARDED_KEY, 'true')
    setOnboarded(true)
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

  const chooseLanguage = useCallback(
    (code: LanguageCode) => {
      localStorage.setItem(LANG_CHOSEN_KEY, 'true')
      setLanguageChosen(true)
      setLanguage(code)
    },
    [setLanguage],
  )

  const register = useCallback((name: string, kinshipTerm: string) => {
    localStorage.setItem(REGISTERED_KEY, 'true')
    setRegistered(true)
    setPatientState((prev) => {
      const next = { ...prev, name, kinshipTerm }
      void cacheSet(PATIENT_KEY, next)
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
    needsCheckIn: moodToday === null,
    onboarded,
    registered,
    languageChosen,
    stillness,
    setLanguage,
    checkIn,
    completeSession,
    setProfile,
    setPatient,
    register,
    chooseLanguage,
    setStillness,
    sync: doSync,
  }

  return <SmaranCtx.Provider value={value}>{children}</SmaranCtx.Provider>
}
