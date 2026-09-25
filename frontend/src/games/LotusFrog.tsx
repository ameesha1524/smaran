import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Game } from './lotus-frog/engine/Game'
import { ambience } from './lotus-frog/audio/Ambience'
import { applyFrogReport, toSessionDraft } from './lotus-frog/cognitive/smaran'
import type { FrogSessionReport } from './lotus-frog/cognitive/report'
import { useSmaran } from '../state/SmaranContext'

/**
 * The Lotus Frog — a calm pixel pond where she taps bugs and the frog catches
 * them. No score, no timer, no failure; the pond simply flourishes.
 *
 * Underneath, the game's CognitiveTracker watches the whole visit (how quickly
 * she spots a bug, how cleanly she taps, whether she plays or drifts off) and
 * hands back one report when she leaves. That report is folded into her
 * cognitive profile with a confidence-weighted EMA (see cognitive/smaran.ts).
 * She is never shown any of it.
 *
 * The game is a self-contained canvas engine; this screen only mounts it,
 * gives her a way home, and closes the session on the way out.
 */

/** Visits shorter than this are treated as accidental opens (or React
 *  StrictMode's dev-only double mount) and don't touch the profile. */
const MIN_SESSION_MS = 5000

/** The last few reports, kept on-device for the caregiver view / debugging. */
const REPORTS_KEY = 'smaran.lotusFrog.reports'
const KEEP_REPORTS = 20

function saveReport(report: FrogSessionReport): void {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    const prev = Array.isArray(list) ? (list as FrogSessionReport[]) : []
    localStorage.setItem(REPORTS_KEY, JSON.stringify([...prev, report].slice(-KEEP_REPORTS)))
  } catch {
    // A full or blocked store must not take the pond down with it.
  }
}

export default function LotusFrog() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const navigate = useNavigate()
  const { profile, setProfile, completeSession, moodToday } = useSmaran()

  // The game outlives several renders; read the latest of each at session end.
  const profileRef = useRef(profile)
  profileRef.current = profile
  const setProfileRef = useRef(setProfile)
  setProfileRef.current = setProfile
  const completeRef = useRef(completeSession)
  completeRef.current = completeSession
  const moodRef = useRef(moodToday)
  moodRef.current = moodToday

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const game = new Game(canvas, undefined, undefined, (report) => {
      if (report.durationMs < MIN_SESSION_MS) return
      // Order matters: fold the four-domain reading in first, then let
      // completeSession water the garden and count the visit. The reverse
      // would have completeSession write back a profile captured before this.
      const next = applyFrogReport(profileRef.current, report)
      setProfileRef.current(next)
      saveReport(report)
      // A visit with no mood recorded is still a visit; the pond is calm by
      // nature, so that is the honest default rather than leaving it unset.
      void completeRef.current(toSessionDraft(report, moodRef.current ?? 'PEACEFUL'))
      if (import.meta.env.DEV) {
        console.info('[lotus-frog] session report', report)
        console.info('[lotus-frog] profile domains →', next.domainScores)
      }
    })
    game.start()

    // Browsers only allow sound after a gesture; her first tap starts the pond.
    const wake = () => ambience.resume()
    window.addEventListener('pointerdown', wake)

    return () => {
      window.removeEventListener('pointerdown', wake)
      game.endSession() // emits the report → profile (once)
      game.dispose()
      ambience.suspend()
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0f1e', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        aria-label="A lotus pond with a frog. Tap a bug and the frog will catch it."
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
          cursor: 'none',
          touchAction: 'none',
        }}
      />
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          minHeight: 'var(--tap-target, 60px)',
          padding: '10px 18px',
          fontFamily: "'Pixelify Sans', sans-serif",
          fontSize: 20,
          color: '#f0c94a',
          background: '#1b2a3a',
          border: '4px solid #f0c94a',
          borderRadius: 0,
          boxShadow: '4px 4px 0 #000',
          cursor: 'pointer',
        }}
      >
        ← Back to the pond
      </button>
    </div>
  )
}
