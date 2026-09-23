import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CompositeLoad, LoadMeter, reportLoad, startAffect, subscribeCognitiveStream, type AffectHandle } from '../lib/affect'
import { axesFor, ease, type DifficultyAxes } from '../lib/cognitiveProfile'
import { setTone } from '../lib/ambient'
import { useSmaran } from '../state/SmaranContext'
import type { GameType, SessionResultDraft } from '../lib/types'
import { federatedRound, loadModel, predictSuccess, toSample } from '../lib/federated'
import { cacheGet, cacheSet } from '../lib/db'

/**
 * One hook that every game uses, so that adaptation behaves identically in all
 * four of them.
 *
 * What it does, in order:
 *   · opens a session id and starts the load meter
 *   · asks the on-device model whether this tier is likely to go well; if not,
 *     starts one tier easier *before she ever sees a hard screen*
 *   · watches load from behaviour (always) and face geometry (when a camera is
 *     available and permitted), plus the server's SSE stream
 *   · when load crosses her own anxiety threshold, eases all three axes and
 *     shifts the ambient tone 528 → 432, silently, mid-session
 *   · on finish, waters the garden, updates the profile, and runs a federated
 *     round with the session history
 *
 * The patient is never told that any of this happened. That is the point.
 */

export interface AdaptiveSession {
  sessionId: string
  axes: DifficultyAxes
  difficultyTier: number
  tapTarget: number
  /** Call the moment a target becomes tappable. */
  markTargetShown(): void
  /** Call when a tap lands. Returns the latency it recorded. */
  recordTap(): number
  recordReplay(): void
  recordCorrection(): void
  /** Hand back the camera element ref if you want face geometry in the mix. */
  videoRef: React.RefObject<HTMLVideoElement>
  /** Finish and persist. `completionRate` is 0–1; there is no pass mark. */
  finish(completionRate: number): Promise<{ milestone: boolean }>
  /** Whether the session has already been eased — for caregiver logs only. */
  easedCount: number
}

const HISTORY_KEY = 'fl.history'

export function useAdaptiveSession(gameType: GameType): AdaptiveSession {
  const { profile, route, moodToday, completeSession, patient, tapTarget } = useSmaran()

  const sessionId = useMemo(() => `${patient.id}:${gameType}:${Date.now()}`, [patient.id, gameType])
  const startedAt = useRef(Date.now())
  const meter = useRef(new LoadMeter())
  const composite = useRef(new CompositeLoad(meter.current))
  const affect = useRef<AffectHandle | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const shownAt = useRef<number | null>(null)
  const latencies = useRef<number[]>([])
  const hesitations = useRef(0)
  const peakLoad = useRef(0)

  const [difficultyTier, setDifficultyTier] = useState(route.difficultyTier)
  const [axes, setAxes] = useState<DifficultyAxes>(() => axesFor(route.difficultyTier))
  const [easedCount, setEasedCount] = useState(0)

  /* -------------------- start one tier easier when the model expects trouble */

  useEffect(() => {
    let alive = true
    ;(async () => {
      const model = await loadModel()
      if (!alive || model.samples < 4) return
      const { x } = toSample(
        {
          gameType,
          startedAt: Date.now(),
          durationMs: 0,
          completionRate: 0.8,
          difficultyTier: route.difficultyTier,
          cognitiveLoadScore: 0,
          moodAtStart: moodToday ?? 'QUIET',
        },
        latencies.current.length ? latencies.current[0] : 1800,
        0,
      )
      if (predictSuccess(model, x) < 0.45) {
        setDifficultyTier((t) => Math.max(1, t - 1))
        setAxes((a) => ease(a))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------- the ease itself */

  const applyEase = useCallback(
    (reason: string) => {
      setAxes((a) => {
        const next = ease(a)
        // Already at the gentlest setting: stay there rather than churning.
        if (next.choiceCount === a.choiceCount && next.hintRichness === a.hintRichness) return a
        return next
      })
      setDifficultyTier((t) => Math.max(1, t - 1))
      setEasedCount((n) => n + 1)
      // The room changes key underneath her at the same moment.
      setTone(432)
      if (import.meta.env.DEV) console.debug('[smaran] eased:', reason)
    },
    [],
  )

  /* ------------------------------------------------ camera + sampling loop */

  useEffect(() => {
    let cancelled = false
    // Only ask for the camera when a reading could actually change something.
    if (profile.anxietyThreshold < 0.9) {
      void (async () => {
        if (!videoRef.current) return
        const handle = await startAffect(videoRef.current)
        if (cancelled) {
          handle.stop()
          return
        }
        affect.current = handle
      })()
    }

    const interval = window.setInterval(() => {
      const vision = affect.current?.read() ?? { browFurrow: null, eyeOpenness: null }
      const fixation = shownAt.current ? Date.now() - shownAt.current : null
      const sample = composite.current.sample(vision, fixation)
      peakLoad.current = Math.max(peakLoad.current, sample.score)
      if (sample.score > profile.anxietyThreshold) {
        applyEase(`local load ${sample.score.toFixed(2)} > threshold ${profile.anxietyThreshold}`)
        meter.current.reset()
      }
      reportLoad(sessionId, sample)
    }, 2500)

    const unsubscribe = subscribeCognitiveStream(sessionId, (event) => {
      applyEase(event.reason)
      setTone(event.ambientHz)
    })

    return () => {
      cancelled = true
      window.clearInterval(interval)
      unsubscribe()
      affect.current?.stop()
      affect.current = null
    }
  }, [sessionId, profile.anxietyThreshold, applyEase])

  /* ------------------------------------------------------------- recording */

  const markTargetShown = useCallback(() => {
    shownAt.current = Date.now()
  }, [])

  const recordTap = useCallback(() => {
    const latency = shownAt.current ? Date.now() - shownAt.current : 0
    shownAt.current = null
    if (latency > 0) {
      latencies.current.push(latency)
      meter.current.recordTap(latency)
      if (latency > 5000) hesitations.current++
    }
    return latency
  }, [])

  const recordReplay = useCallback(() => meter.current.recordReplay(), [])
  const recordCorrection = useCallback(() => meter.current.recordCorrection(), [])

  /* ---------------------------------------------------------------- finish */

  const finish = useCallback(
    async (completionRate: number) => {
      const draft: SessionResultDraft = {
        gameType,
        startedAt: startedAt.current,
        durationMs: Date.now() - startedAt.current,
        completionRate: Math.max(0, Math.min(1, completionRate)),
        difficultyTier,
        cognitiveLoadScore: Number(peakLoad.current.toFixed(3)),
        moodAtStart: moodToday ?? 'QUIET',
      }

      const outcome = await completeSession(draft)

      // Federated round: local fit on this device's own history, gradient out.
      const history = (await cacheGet<{ x: number[]; y: number }[]>(HISTORY_KEY)) ?? []
      const medianTap = latencies.current.length
        ? [...latencies.current].sort((a, b) => a - b)[Math.floor(latencies.current.length / 2)]
        : 2000
      const hesitationRate = latencies.current.length ? hesitations.current / latencies.current.length : 0
      history.push(toSample(draft, medianTap, hesitationRate))
      const trimmed = history.slice(-60)
      await cacheSet(HISTORY_KEY, trimmed)
      void federatedRound(patient.id, trimmed)

      return outcome
    },
    [completeSession, difficultyTier, gameType, moodToday, patient.id],
  )

  return {
    sessionId,
    axes,
    difficultyTier,
    tapTarget: Math.max(tapTarget, route.tapTargetPx),
    markTargetShown,
    recordTap,
    recordReplay,
    recordCorrection,
    videoRef,
    finish,
    easedCount,
  }
}
