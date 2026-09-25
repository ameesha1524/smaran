import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GameShell, { Progress, SessionComplete } from '../components/GameShell'
import { useAdaptiveSession } from '../hooks/useAdaptiveSession'
import { useBloomLayer, MilestoneVeil } from '../components/Bloom'
import { useSmaran } from '../state/SmaranContext'
import { family as familyApi } from '../lib/api'
import { demoFamily } from '../lib/demoData'
import { cue, setTone } from '../lib/ambient'
import { speak } from '../lib/speechEngine'
import type { FamilyMember, GrovePhase } from '../lib/types'
import './games.css'

/**
 * Family Grove — facial memory, associative memory, relational orientation and,
 * above all, emotional grounding. This is the game that runs at 528 Hz.
 *
 * The four phases advance **per family member, individually**. She may be at
 * Recall for her daughter and Introduction for a cousin she last saw in 1998,
 * and that is not a failure of anything — it is simply true, and the game is
 * built around it being true.
 *
 *   1 Introduction   names visible on every fruit
 *   2 Recognition    initials only
 *   3 Identification a question, and cards to choose from
 *   4 Recall         no cards; she touches the tree
 *
 * Getting it right tells the family. The family record a new voice note. The
 * new voice note appears the next time she opens the grove. That is the loop.
 */

const RELATION_COLOURS: Record<string, string> = {
  Daughter: '#c8773a',
  Son: '#5a7840',
  Granddaughter: '#e8c84a',
  Grandson: '#e8c84a',
  Brother: '#7a9bd4',
  Sister: '#7a9bd4',
  Neighbour: '#b8b49e',
}

/** Where the fruit hang. Fixed positions so the tree is the same tree daily. */
const FRUIT_SPOTS = [
  { x: 300, y: 150 },
  { x: 168, y: 214 },
  { x: 430, y: 212 },
  { x: 232, y: 300 },
  { x: 380, y: 306 },
  { x: 300, y: 250 },
]

const ROUNDS = 4

export default function FamilyGrove() {
  const { patient, language, tapTarget } = useSmaran()
  const session = useAdaptiveSession('FAMILY_GROVE')
  const { burst, layer } = useBloomLayer()
  const navigate = useNavigate()

  const [members, setMembers] = useState<FamilyMember[]>(demoFamily)
  const [round, setRound] = useState(0)
  const [foundId, setFoundId] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [blooms, setBlooms] = useState(0)
  const [milestone, setMilestone] = useState(false)
  const [done, setDone] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Family Grove is the one place the room is tuned for grounding, not calm.
  useEffect(() => {
    setTone(528)
    return () => setTone(432)
  }, [])

  useEffect(() => {
    void familyApi.members(patient.id).then((list) => {
      if (list.length) setMembers(list)
    })
  }, [patient.id])

  const subject = useMemo(() => members[round % Math.max(1, members.length)], [members, round])
  const phase: GrovePhase = subject?.currentPhase ?? 1

  /* --------------------------------------------------------- her voice */

  const playVoice = useCallback(
    (isReplay: boolean) => {
      if (!subject) return
      if (isReplay) session.recordReplay()
      setPlaying(true)

      const finish = () => {
        setPlaying(false)
        session.markTargetShown()
      }

      if (subject.voiceNoteUrl) {
        const el = audioRef.current ?? new Audio(subject.voiceNoteUrl)
        audioRef.current = el
        el.src = subject.voiceNoteUrl
        el.onended = finish
        void el.play().catch(finish)
        return
      }

      // No recording yet: the caregiver's written hint, read warmly, rather
      // than silence or a stock voice pretending to be family.
      const line =
        phase === 1
          ? `This is ${subject.name}, your ${subject.relationship.toLowerCase()}. ${subject.contextHint}`
          : phase === 4
            ? `Someone is speaking. ${subject.contextHint} Touch them on the tree.`
            : `${subject.contextHint} Who is speaking?`
      void speak(line, { language, rate: 0.82, onEnd: finish })
    },
    [subject, phase, language, session],
  )

  useEffect(() => {
    setFoundId(null)
    setShowHint(false)
    const id = window.setTimeout(() => playVoice(false), 800)
    return () => {
      window.clearTimeout(id)
      audioRef.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, subject?.id])

  /* ------------------------------------------------------------ answering */

  const answer = async (memberId: string, e: { clientX: number; clientY: number }) => {
    if (!subject || done || foundId) return
    const latency = session.recordTap()

    if (memberId === subject.id) {
      cue('petal')
      burst(e.clientX, e.clientY)
      setFoundId(memberId)
      setShowHint(true)
      setBlooms((b) => b + 1)

      // Tell the family. They are prompted to record a new voice note, which
      // is what she will hear next time.
      void familyApi.recognised(patient.id, memberId, true, latency)

      window.setTimeout(async () => {
        if (round + 1 >= ROUNDS) {
          const outcome = await session.finish(1)
          setDone(true)
          if (outcome.milestone) setMilestone(true)
        } else {
          setRound((r) => r + 1)
        }
      }, 2600)
      return
    }

    session.recordCorrection()
    void familyApi.recognised(patient.id, subject.id, false, latency)
    setReturning(memberId)
    setShowHint(true)
    window.setTimeout(() => setReturning(null), 950)
    if (session.axes.hintRichness >= 1) {
      void speak(subject.contextHint, { language, rate: 0.82 })
    }
  }

  /* ------------------------------------------------------- choice cards */

  const cards = useMemo(() => {
    if (!subject || phase < 3) return []
    const others = members.filter((m) => m.id !== subject.id)
    return shuffle([subject, ...others.slice(0, Math.max(1, session.axes.choiceCount - 1))], round + 5)
  }, [members, subject, phase, session.axes.choiceCount, round])

  const restart = () => {
    setRound(0)
    setBlooms(0)
    setDone(false)
    setFoundId(null)
  }

  if (done) {
    return (
      <GameShell title="Family Grove" spoken="Your garden drank today." tag="Facial memory" videoRef={session.videoRef}>
        <SessionComplete
          blooms={blooms}
          domains={['Facial memory', 'Associative memory', 'Relational orientation', 'Emotional grounding']}
          onAgain={restart}
          onHome={() => navigate('/')}
          language={language}
        />
        <MilestoneVeil
          show={milestone}
          onDone={() => setMilestone(false)}
          text="A lotus opened in your garden. Your family has been told."
        />
        {layer}
      </GameShell>
    )
  }

  return (
    <GameShell
      title="Family Grove"
      spoken={subject ? `${subject.contextHint} Who is speaking?` : ''}
      tag={phase === 4 ? 'Recall' : phase === 3 ? 'Identification' : phase === 2 ? 'Recognition' : 'Introduction'}
      videoRef={session.videoRef}
      footer={<Progress total={ROUNDS} done={round} />}
    >
      {/* ------------------------------------------------------ the tree */}
      <svg width="100%" viewBox="0 0 600 420" style={{ maxWidth: 640 }} aria-label="The family tree">
        {/* trunk and branches, drawn like the hills: outlined, never flat */}
        <path
          d="M292,406 C288,340 286,300 292,264 C296,238 300,214 300,186"
          fill="none"
          stroke="#2a1c12"
          strokeWidth="22"
          strokeLinecap="round"
        />
        <path d="M296,300 C262,282 224,258 186,230" fill="none" stroke="#2a1c12" strokeWidth="11" strokeLinecap="round" />
        <path d="M298,292 C336,276 386,250 424,226" fill="none" stroke="#2a1c12" strokeWidth="11" strokeLinecap="round" />
        <path d="M294,340 C266,330 244,318 228,306" fill="none" stroke="#2a1c12" strokeWidth="8" strokeLinecap="round" />
        <path d="M298,344 C328,334 356,322 376,310" fill="none" stroke="#2a1c12" strokeWidth="8" strokeLinecap="round" />

        {/* canopy: folk-art leaf clusters */}
        {[
          { x: 300, y: 140, r: 96 },
          { x: 186, y: 206, r: 70 },
          { x: 428, y: 204, r: 74 },
          { x: 232, y: 290, r: 52 },
          { x: 382, y: 296, r: 54 },
        ].map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={c.r} fill="#2f5030" fillOpacity="0.55" stroke="#050a12" strokeWidth="1.4" />
            <circle cx={c.x - c.r * 0.3} cy={c.y - c.r * 0.2} r={c.r * 0.58} fill="#3a5c2c" fillOpacity="0.5" stroke="#050a12" strokeWidth="1" />
          </g>
        ))}

        {/* roots */}
        <path d="M264,406 C244,398 224,404 206,412 M328,406 C350,398 372,404 392,412" fill="none" stroke="#2a1c12" strokeWidth="7" strokeLinecap="round" />

        {/* ------------------------------------------------------ the fruit */}
        {members.slice(0, FRUIT_SPOTS.length).map((m, i) => {
          const spot = FRUIT_SPOTS[i]
          const found = foundId === m.id
          const colour = RELATION_COLOURS[m.relationship] ?? 'var(--chalk-dim)'
          const tappable = phase === 4 || phase <= 2
          const initials = m.name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)

          return (
            <g
              key={m.id}
              className={found ? 'fruit-found' : undefined}
              style={{ cursor: tappable ? 'pointer' : 'default' }}
              onClick={(e) => tappable && void answer(m.id, { clientX: e.clientX, clientY: e.clientY })}
            >
              {/* the stem it hangs by */}
              <line x1={spot.x} y1={spot.y - 34} x2={spot.x} y2={spot.y - 22} stroke="#2a1c12" strokeWidth="2.4" />
              {found && <circle cx={spot.x} cy={spot.y} r="34" fill="var(--gold)" opacity="0.2" />}
              {m.photoUrl ? (
                <>
                  <clipPath id={`clip-${m.id}`}>
                    <circle cx={spot.x} cy={spot.y} r="26" />
                  </clipPath>
                  <image
                    href={m.photoUrl}
                    x={spot.x - 26}
                    y={spot.y - 26}
                    width="52"
                    height="52"
                    clipPath={`url(#clip-${m.id})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle cx={spot.x} cy={spot.y} r="26" fill="none" stroke={colour} strokeWidth="2.4" />
                </>
              ) : (
                <>
                  <circle cx={spot.x} cy={spot.y} r="26" fill={colour} fillOpacity="0.32" stroke={colour} strokeWidth="2.2" />
                  <text x={spot.x} y={spot.y + 7} textAnchor="middle" fontSize="19" fill="var(--chalk)" fontFamily="'Noto Sans', sans-serif">
                    {initials}
                  </text>
                </>
              )}

              {/* Phase 1 shows every name. Phase 2 and up do not. */}
              {phase === 1 && (
                <text x={spot.x} y={spot.y + 46} textAnchor="middle" fontSize="16" fill="var(--chalk)" fontFamily="'Noto Sans', sans-serif">
                  {m.name}
                </text>
              )}
              {found && (
                <text x={spot.x} y={spot.y + (phase === 1 ? 66 : 46)} textAnchor="middle" fontSize="15" fill="var(--gold-soft)" fontFamily="'Playfair Display', serif" fontStyle="italic">
                  {m.kinshipTermLocal}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* ------------------------------------------------- the voice strip */}
      <button
        type="button"
        onClick={() => playVoice(true)}
        className="stone mt-6 flex items-center gap-4 px-7 py-4"
        style={{ minHeight: tapTarget, borderRadius: 999 }}
      >
        <svg width="34" height="28" viewBox="0 0 34 28" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              className={playing ? 'voice-bar' : undefined}
              x={3 + i * 6.4}
              y={6}
              width="3.6"
              height="16"
              rx="1.8"
              fill="var(--gold)"
              opacity={playing ? 1 : 0.5}
              style={{ animationDelay: `${i * 0.13}s` }}
            />
          ))}
        </svg>
        <span style={{ fontSize: 18 }}>{playing ? 'listening…' : 'Hear them again'}</span>
      </button>

      {/* --------------------------------------------------- choice cards */}
      {phase === 3 && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          {cards.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={(e) => void answer(m.id, e)}
              className={`petal-card flex flex-col items-center justify-center gap-2 px-5 py-4 ${returning === m.id ? 'returning' : ''}`}
              data-state={foundId === m.id ? 'correct' : returning === m.id ? 'returning' : undefined}
              style={{ minWidth: Math.max(tapTarget, 150), minHeight: Math.max(tapTarget, 120) }}
            >
              <span
                className="flex items-center justify-center"
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 999,
                  border: `2px solid ${RELATION_COLOURS[m.relationship] ?? 'var(--chalk-dim)'}`,
                  fontSize: 18,
                }}
              >
                {m.name[0]}
              </span>
              <span style={{ fontSize: 18, color: 'var(--chalk)' }}>{m.name}</span>
              <span style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>{m.relationship}</span>
            </button>
          ))}
        </div>
      )}

      {phase === 4 && (
        <p className="mt-5 font-serif italic" style={{ fontSize: 19, color: 'var(--gold-soft)' }}>
          Touch them on the tree.
        </p>
      )}

      {/* ----------------------------------- the caregiver's memory hint */}
      {subject && (showHint || session.axes.hintRichness >= 2) && (
        <p
          className="plaque-fade mt-6 max-w-xl text-center font-sans"
          style={{ fontSize: 17, color: 'var(--chalk-dim)' }}
        >
          {subject.contextHint}
        </p>
      )}

      {layer}
    </GameShell>
  )
}

function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
