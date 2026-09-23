import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GameShell, { SessionComplete } from '../components/GameShell'
import { Progress } from './WeaversLoom'
import { useAdaptiveSession } from '../hooks/useAdaptiveSession'
import { useBloomLayer } from '../components/Bloom'
import { useSmaran } from '../state/SmaranContext'
import { demoStories, type DemoStory } from '../lib/demoData'
import { onSpeakingChange, speak, stopSpeaking } from '../lib/speechEngine'
import { cue } from '../lib/ambient'
import { t } from '../i18n/strings'
import './games.css'

/**
 * Grandmother's Tale — short-term auditory memory and language retention.
 *
 * A story the family recorded plays by itself, slowly (0.82×), and then she
 * chooses the picture that completes it. The recording is the caregiver's own
 * voice where one exists; where it does not, Smaran reads the caregiver's
 * written memory aloud rather than inventing a story, because a story that is
 * not hers measures nothing and comforts no one.
 *
 * Listening again is free and unlimited. It is counted — a rising replay count
 * is a real signal — but it is never discouraged, never limited, and never
 * mentioned.
 */

export default function GrandmothersTale() {
  const { language, tapTarget, patient } = useSmaran()
  const session = useAdaptiveSession('GRANDMOTHERS_TALE')
  const { burst, layer } = useBloomLayer()
  const navigate = useNavigate()

  const stories = demoStories
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'listening' | 'choosing' | 'answered'>('listening')
  const [speaking, setSpeaking] = useState(false)
  const [returning, setReturning] = useState<string | null>(null)
  const [blooms, setBlooms] = useState(0)
  const [done, setDone] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const story: DemoStory | undefined = stories[index]

  useEffect(() => onSpeakingChange(setSpeaking), [])

  /* --------------------------------------------------------- the telling */

  const tell = useCallback(
    (isReplay: boolean) => {
      if (!story) return
      if (isReplay) session.recordReplay()
      setPhase('listening')

      // A recorded family voice always wins over synthesis.
      const recorded = (story as DemoStory & { voiceUrl?: string }).voiceUrl
      if (recorded) {
        const el = audioRef.current ?? new Audio(recorded)
        audioRef.current = el
        el.playbackRate = 0.82
        el.onended = () => {
          setPhase('choosing')
          session.markTargetShown()
        }
        void el.play().catch(() => {
          setPhase('choosing')
          session.markTargetShown()
        })
        return
      }

      void speak(`${story.text} … ${story.question}`, {
        language,
        rate: 0.82,
        onEnd: () => {
          setPhase('choosing')
          session.markTargetShown()
        },
      })
    },
    [story, language, session],
  )

  // The voice starts on its own. She does not have to find a play button first.
  useEffect(() => {
    const id = window.setTimeout(() => tell(false), 900)
    return () => {
      window.clearTimeout(id)
      stopSpeaking()
      audioRef.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  /* ------------------------------------------------------------ choices */

  const options = useMemo(() => {
    if (!story) return []
    const correct = story.options.find((o) => o.correct)!
    const wrong = story.options.filter((o) => !o.correct).slice(0, Math.max(1, session.axes.choiceCount - 1))
    return [correct, ...wrong].sort((a, b) => a.id.localeCompare(b.id))
  }, [story, session.axes.choiceCount])

  const choose = async (option: (typeof options)[number], e: React.MouseEvent) => {
    if (phase !== 'choosing' || !story) return
    session.recordTap()

    if (option.correct) {
      cue('petal')
      burst(e.clientX, e.clientY)
      setPhase('answered')
      setBlooms((b) => b + 1)
      window.setTimeout(async () => {
        if (index + 1 >= stories.length) {
          setDone(true)
          await session.finish(1)
        } else {
          setIndex((i) => i + 1)
        }
      }, 1800)
      return
    }

    // Gently home again, and the story is offered once more — no penalty sound,
    // no mark against her, no "try again" scolding.
    session.recordCorrection()
    setReturning(option.id)
    window.setTimeout(() => setReturning(null), 950)
    if (session.axes.hintRichness >= 1) {
      void speak(story.question, { language, rate: 0.82 })
    }
  }

  const restart = () => {
    setIndex(0)
    setBlooms(0)
    setDone(false)
    setPhase('listening')
  }

  if (done) {
    return (
      <GameShell title="Grandmother's Tale" spoken="Your garden drank today." tag="Auditory memory" videoRef={session.videoRef}>
        <SessionComplete
          blooms={blooms}
          domains={['Short-term auditory memory', 'Language retention']}
          onAgain={restart}
          onHome={() => navigate('/')}
          language={language}
        />
      </GameShell>
    )
  }

  return (
    <GameShell
      title="Grandmother's Tale"
      spoken={story ? `${story.text} … ${story.question}` : ''}
      tag="Auditory memory"
      videoRef={session.videoRef}
      footer={<Progress total={stories.length} done={index} />}
    >
      {/* ------------------------------------------------- the leaf you press */}
      <button
        type="button"
        onClick={() => tell(true)}
        className="flex flex-col items-center gap-3"
        aria-label={t(language, 'listenAgain')}
        style={{ minHeight: tapTarget }}
      >
        <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
          <circle cx="66" cy="66" r="60" fill="none" stroke="var(--gold)" strokeWidth="1" opacity={speaking ? 0.7 : 0.25} />
          <path
            d="M66,118 C26,94 22,44 66,14 C110,44 106,94 66,118 Z"
            fill="var(--olive)"
            fillOpacity={speaking ? 0.5 : 0.3}
            stroke="var(--olive-light)"
            strokeWidth="2"
          />
          <path d="M66,118 C61,80 61,46 66,14" fill="none" stroke="var(--olive-light)" strokeWidth="1.5" />
          {speaking ? (
            <g>
              {[-14, 0, 14].map((dx, i) => (
                <rect
                  key={dx}
                  className="voice-bar"
                  x={64 + dx}
                  y={56}
                  width="4"
                  height="22"
                  rx="2"
                  fill="var(--gold)"
                  style={{ animationDelay: `${i * 0.18}s` }}
                />
              ))}
            </g>
          ) : (
            <path d="M58,52 L58,80 L82,66 Z" fill="var(--gold)" opacity="0.85" />
          )}
        </svg>
        <span className="font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
          {speaking ? 'listening to the water…' : t(language, 'listenAgain')}
        </span>
      </button>

      {/* ---------------------------------------------------------- the ask */}
      {story && (
        <p
          className="inscription mt-8 max-w-3xl text-center font-serif italic"
          style={{ fontSize: 'clamp(20px, 2.8vw, 30px)', color: 'var(--gold-soft)', opacity: phase === 'listening' ? 0.4 : 1, transition: 'opacity 1.2s ease-in-out' }}
        >
          {story.question}
        </p>
      )}

      {/* ------------------------------------------------------- the cards */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-5" style={{ opacity: phase === 'listening' ? 0.35 : 1, transition: 'opacity 1.4s ease-in-out' }}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={(e) => void choose(o, e)}
            disabled={phase !== 'choosing'}
            className={`petal-card flex flex-col items-center justify-center gap-2 p-4 ${returning === o.id ? 'returning' : ''}`}
            data-state={phase === 'answered' && o.correct ? 'correct' : returning === o.id ? 'returning' : undefined}
            style={{ width: Math.max(tapTarget, 150), height: Math.max(tapTarget, 150) }}
          >
            <span style={{ fontSize: 46 }} aria-hidden="true">
              {o.glyph}
            </span>
            <span style={{ fontSize: 17, color: 'var(--chalk)' }}>{o.label}</span>
          </button>
        ))}
      </div>

      {/* The caregiver's own memory hint, shown only when the axes allow it. */}
      {session.axes.hintRichness >= 2 && phase === 'choosing' && (
        <p className="mt-6 font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          It was something you could eat, on a festival morning.
        </p>
      )}

      {/* Patient-specific content is the whole point; say so where it is absent. */}
      {patient.id === 'demo-patient' && (
        <p className="mt-8 font-sans" style={{ fontSize: 12, color: 'var(--chalk-dim)', opacity: 0.45 }}>
          Placeholder story — replace with a story the family recorded.
        </p>
      )}

      {layer}
    </GameShell>
  )
}
