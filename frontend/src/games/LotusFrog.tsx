import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Game } from './lotus-frog/engine/Game'
import { ambience } from './lotus-frog/audio/Ambience'
import { toSessionDraft } from './lotus-frog/cognitive/smaran'
import type { FrogSessionReport } from './lotus-frog/cognitive/report'
import { useSmaran } from '../state/SmaranContext'

/**
 * The Lotus Frog — a calm pixel pond where she taps bugs and the frog catches
 * them. No score, no timer, no failure; the pond simply flourishes.
 *
 * Underneath, the game's CognitiveTracker watches the whole visit (how quickly
 * she spots a bug, how cleanly she taps, whether she plays or drifts off) and
 * hands back one report when she leaves. Its four domain readings travel on
 * the session like any other game's and are folded in by the same EMA
 * (lib/cognitiveMap.ts), on the device and again on the server. She is never
 * shown any of it.
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
  const { completeSession, moodToday } = useSmaran()

  // The game outlives several renders; read the latest of each at session end.
  const completeRef = useRef(completeSession)
  completeRef.current = completeSession
  const moodRef = useRef(moodToday)
  moodRef.current = moodToday

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const game = new Game(canvas, undefined, undefined, (report) => {
      if (report.durationMs < MIN_SESSION_MS) return
      saveReport(report)
      // A visit with no mood recorded is still a visit; the pond is calm by
      // nature, so that is the honest default rather than leaving it unset.
      const draft = toSessionDraft(report, moodRef.current ?? 'PEACEFUL')
      void completeRef.current(draft)
      if (import.meta.env.DEV) {
        console.info('[lotus-frog] session report', report)
        console.info('[lotus-frog] domain readings →', draft.domainReadings)
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
