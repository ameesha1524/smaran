import { useEffect, useRef, useState } from 'react'
import type { LanguageCode, MoodKey, VoiceNote } from '../lib/types'

/**
 * The three things that float on the pond and ask nothing of her.
 *
 * All of them share one rule: they appear on their own, they can be ignored,
 * and ignoring them costs nothing. Nothing here blocks the pond, nothing
 * returns a second time to insist, and nothing records a refusal. That is the
 * difference between a companion and a form.
 *
 * All three are drawn with the screen's pixel grammar — four-pixel borders,
 * hard offset shadows, square corners, `steps()` timing. A blur or a rounded
 * corner anywhere here would give the whole scene away.
 */

const SHADOW = '4px 4px 0 #04070f'

/* ------------------------------------------------------------ mood overlay */

const MOODS: { glyph: string; mood: MoodKey; label: string }[] = [
  { glyph: '😊', mood: 'JOYFUL', label: 'Joyful' },
  { glyph: '😐', mood: 'QUIET', label: 'Quiet' },
  { glyph: '😔', mood: 'A_LITTLE_LOW', label: 'A little low' },
]

export interface MoodDriftProps {
  /** Nothing is shown once the day already has a mood. */
  moodToday: MoodKey | null
  onPick(mood: MoodKey): void
  tapTarget: number
}

/**
 * A row of three faces that drifts in after a while and leaves by itself.
 *
 * It waits three seconds so it is not the first thing she meets, and it
 * withdraws after ten so an unanswered question does not sit on screen looking
 * like a task. There is no retry: if today goes unrecorded, today goes
 * unrecorded.
 */
export function MoodDrift({ moodToday, onPick, tapTarget }: Readonly<MoodDriftProps>) {
  const [phase, setPhase] = useState<'waiting' | 'in' | 'out'>('waiting')

  useEffect(() => {
    if (moodToday !== null) return
    const appear = window.setTimeout(() => setPhase('in'), 3000)
    const withdraw = window.setTimeout(() => setPhase('out'), 13000)
    return () => {
      window.clearTimeout(appear)
      window.clearTimeout(withdraw)
    }
  }, [moodToday])

  if (moodToday !== null || phase === 'waiting') return null

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 498,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        gap: 26,
        opacity: phase === 'in' ? 1 : 0,
        transition: 'opacity 1.4s steps(7)',
        pointerEvents: phase === 'in' ? 'auto' : 'none',
        zIndex: 24,
      }}
    >
      {MOODS.map(({ glyph, mood, label }) => (
        <button
          key={mood}
          type="button"
          onClick={() => onPick(mood)}
          aria-label={label}
          style={{
            width: Math.max(tapTarget, 92),
            height: Math.max(tapTarget, 92),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(12,22,48,0.72)',
            border: '4px solid #3a4c8c',
            borderRadius: 0,
            boxShadow: SHADOW,
            fontSize: 44,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          {glyph}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------- journal entry */

function QuillGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#e6c55a" d="M7 0h2v1h-2zM6 1h2v1h-2zM5 2h2v1h-2zM4 3h2v1h-2zM3 4h2v1h-2zM2 5h2v1h-2zM2 6h1v1h-1z" />
      <path fill="#c9a640" d="M8 1h1v1h-1zM7 2h1v1h-1zM6 3h1v1h-1zM5 4h1v1h-1zM4 5h1v1h-1z" />
      <path fill="#8d7458" d="M1 7h2v1h-2zM0 8h2v1h-2z" />
      <path fill="#dbe1ee" d="M0 9h6v1h-6z" />
    </svg>
  )
}

export interface JournalButtonProps {
  language: LanguageCode
  /** Shows a soft gold dot — something is waiting, without saying what. */
  unread: boolean
  onOpen(): void
  tapTarget: number
}

const TODAY_LABEL: Record<string, string> = {
  en: 'Today',
  as: 'আজি',
  mni: 'ঙসি',
  lus: 'Vawiin',
  hi: 'आज का दिन',
  nag: 'Aji',
}

export function JournalButton({ language, unread, onOpen, tapTarget }: Readonly<JournalButtonProps>) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        position: 'absolute',
        left: 48,
        top: 664,
        minHeight: Math.max(tapTarget, 64),
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 20px',
        background: 'rgba(12,22,48,0.7)',
        border: '4px solid #3a4c8c',
        borderRadius: 0,
        boxShadow: SHADOW,
        color: '#f3efe6',
        fontFamily: "'VT323', monospace",
        fontSize: 26,
        lineHeight: 1,
        cursor: 'pointer',
        zIndex: 24,
      }}
    >
      <QuillGlyph />
      <span style={{ fontFamily: "'Noto Sans', system-ui, sans-serif", fontSize: 20 }}>
        {TODAY_LABEL[language] ?? TODAY_LABEL.en}
      </span>
      {unread && (
        <span
          aria-hidden="true"
          style={{ width: 12, height: 12, background: '#f0c94a', boxShadow: '2px 2px 0 #3a2c08' }}
        />
      )}
    </button>
  )
}

/* ------------------------------------------------------------- morning dew */

export interface VoiceNoteCardProps {
  note: VoiceNote
  onListened(id: string): void
}

/**
 * A caregiver's voice note, resting on the water like a leaf.
 *
 * It plays where it sits. Navigating away to a player would mean coming back,
 * and coming back is the thing this app tries hardest never to ask of her.
 */
export function VoiceNoteCard({ note, onListened }: Readonly<VoiceNoteCardProps>) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  const play = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      return
    }
    void el.play().catch(() => setPlaying(false))
  }

  const who = note.fromKinshipTerm?.trim()

  return (
    <button
      type="button"
      onClick={play}
      style={{
        position: 'absolute',
        left: 940,
        top: 660,
        maxWidth: 400,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 22px',
        textAlign: 'left',
        background: '#2a2208',
        border: '4px solid #f0c94a',
        borderRadius: 0,
        boxShadow: SHADOW,
        color: '#f7ecc4',
        fontFamily: "'Noto Sans', system-ui, sans-serif",
        fontSize: 20,
        lineHeight: 1.3,
        cursor: 'pointer',
        zIndex: 24,
      }}
    >
      <span style={{ fontSize: 26, lineHeight: 1 }}>{playing ? '❚❚' : '▶'}</span>
      <span>
        {who ? `${who} left you a message` : 'Someone left you a message'} 🌸
      </span>
      <audio
        ref={audioRef}
        src={note.audioUrl}
        preload="none"
        onPlay={() => {
          setPlaying(true)
          onListened(note.id)
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </button>
  )
}
