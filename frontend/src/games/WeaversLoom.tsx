import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GameShell, { SessionComplete } from '../components/GameShell'
import { useAdaptiveSession } from '../hooks/useAdaptiveSession'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useBloomLayer } from '../components/Bloom'
import { useSmaran } from '../state/SmaranContext'
import { games as gamesApi } from '../lib/api'
import { demoObjects } from '../lib/demoData'
import { cue } from '../lib/ambient'
import { speak } from '../lib/speechEngine'
import type { MeaningfulObject, SemanticCluster } from '../lib/types'
import './games.css'

/**
 * The Weaver's Loom — visual working memory, pattern and object recognition.
 *
 * Objects that mean something to *this* patient drift across the water like
 * lotus leaves, and she touches the one that is named. There is no timer, ever.
 * A wrong touch is not wrong: the object drifts on and the named one is quietly
 * given a halo, because the model here is errorless learning — prevent the
 * error rather than mark it.
 *
 * Difficulty moves on three axes at once: how rich the spoken hint is, how many
 * objects are on the water, and how fast and how similar they are.
 */

const ROUNDS = 5

interface Drifter {
  object: MeaningfulObject
  lane: number
  duration: number
  delay: number
  reverse: boolean
}

export default function WeaversLoom() {
  const { patient, language, tapTarget } = useSmaran()
  const session = useAdaptiveSession('WEAVERS_LOOM')
  const { burst, layer } = useBloomLayer()
  const reduced = useReducedMotion()
  const navigate = useNavigate()

  const [objects, setObjects] = useState<MeaningfulObject[]>(demoObjects)
  const [round, setRound] = useState(0)
  const [found, setFound] = useState<string[]>([])
  const [returning, setReturning] = useState<string | null>(null)
  const [hinting, setHinting] = useState(false)
  const [done, setDone] = useState(false)
  const [blooms, setBlooms] = useState(0)
  const hintTimer = useRef<number | null>(null)

  useEffect(() => {
    void gamesApi.objects(patient.id).then((list) => {
      if (list && list.length >= 4) setObjects(list)
    })
  }, [patient.id])

  /* ------------------------------------------------------- this round's set */

  const target = useMemo(() => objects[round % objects.length], [objects, round])

  const drifters: Drifter[] = useMemo(() => {
    if (!target) return []
    const { choiceCount, visualClarity } = session.axes

    // At low clarity the distractors are drawn from the *same semantic cluster*
    // as the target, which is a genuinely harder discrimination.
    const sameCluster = objects.filter((o) => o.id !== target.id && o.semanticCluster === target.semanticCluster)
    const others = objects.filter((o) => o.id !== target.id && o.semanticCluster !== target.semanticCluster)
    const pool = visualClarity < 0.75 ? [...sameCluster, ...others] : [...others, ...sameCluster]
    const distractors = pool.slice(0, Math.max(1, choiceCount - 1))

    const set = shuffle([target, ...distractors], round + 13)
    // Higher clarity = slower crossing. Nothing ever moves quickly.
    const base = 22 + visualClarity * 16
    return set.map((object, i) => ({
      object,
      lane: i,
      duration: base + (i % 3) * 4,
      delay: -(i * base) / set.length,
      reverse: i % 2 === 1,
    }))
  }, [objects, target, session.axes, round])

  /* ------------------------------------------------------------ the prompt */

  const promptFor = useCallback(
    (o: MeaningfulObject) => {
      const { hintRichness } = session.axes
      if (hintRichness >= 2) return `Touch the ${o.name.toLowerCase()}. It is the ${describe(o.semanticCluster)}.`
      if (hintRichness === 1) return `Touch the ${o.name.toLowerCase()}.`
      return `Where is the ${o.name.toLowerCase()}?`
    },
    [session.axes],
  )

  useEffect(() => {
    if (done || !target) return
    session.markTargetShown()
    void speak(promptFor(target), { language })

    // A nudge after a long pause — offered, never demanded, and silent.
    if (hintTimer.current) window.clearTimeout(hintTimer.current)
    setHinting(false)
    hintTimer.current = window.setTimeout(() => setHinting(true), session.axes.hintRichness >= 1 ? 7000 : 11000)
    return () => {
      if (hintTimer.current) window.clearTimeout(hintTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, target, done])

  /* -------------------------------------------------------------- taps */

  const tap = async (object: MeaningfulObject, e: React.MouseEvent) => {
    if (done) return
    const latency = session.recordTap()

    if (object.id === target.id) {
      cue('petal')
      burst(e.clientX, e.clientY)
      setFound((f) => [...f, object.id])
      setBlooms((b) => b + 1)

      const next = round + 1
      window.setTimeout(async () => {
        if (next >= ROUNDS) {
          setDone(true)
          await session.finish(1)
        } else {
          setFound([])
          setRound(next)
        }
      }, 1400)
      return
    }

    // Not the named one. Nothing is marked wrong; the object simply settles
    // back onto the water and the named one is given a halo.
    session.recordCorrection()
    setReturning(object.id)
    window.setTimeout(() => setReturning(null), 950)
    setHinting(true)
    if (latency > 0 && session.axes.hintRichness >= 1) {
      void speak(`It is the ${target.name.toLowerCase()}.`, { language })
    }
  }

  const restart = () => {
    setRound(0)
    setFound([])
    setBlooms(0)
    setDone(false)
  }

  if (done) {
    return (
      <GameShell title="The Weaver's Loom" spoken="Your garden drank today." tag="Visual working memory" videoRef={session.videoRef}>
        <SessionComplete
          blooms={blooms}
          domains={['Visual working memory', 'Pattern recognition', 'Semantic memory']}
          onAgain={restart}
          onHome={() => navigate('/')}
          language={language}
        />
      </GameShell>
    )
  }

  return (
    <GameShell
      title="The Weaver's Loom"
      spoken={target ? promptFor(target) : ''}
      tag="Visual working memory"
      videoRef={session.videoRef}
      footer={<Progress total={ROUNDS} done={round} />}
    >
      <p className="inscription mb-10 text-center font-serif italic" style={{ fontSize: 'clamp(20px, 2.8vw, 30px)', color: 'var(--gold-soft)' }}>
        {target ? promptFor(target) : ''}
      </p>

      {reduced ? (
        // Stillness: the same objects, resting on the water in a row.
        <div className="flex flex-wrap items-center justify-center gap-5">
          {drifters.map((d) => (
            <ObjectLeaf
              key={d.object.id}
              object={d.object}
              size={Math.max(tapTarget, 120)}
              halo={hinting && d.object.id === target.id}
              found={found.includes(d.object.id)}
              returning={returning === d.object.id}
              onTap={(e) => void tap(d.object, e)}
            />
          ))}
        </div>
      ) : (
        <div className="relative w-full" style={{ height: Math.max(340, drifters.length * 92) }}>
          {drifters.map((d) => (
            <div
              key={d.object.id}
              className="drifter"
              data-found={found.includes(d.object.id)}
              style={{
                top: d.lane * 88,
                left: 0,
                animationName: d.reverse ? 'driftBack' : 'driftAcross',
                animationDuration: `${d.duration}s`,
                animationDelay: `${d.delay}s`,
              }}
            >
              <ObjectLeaf
                object={d.object}
                size={Math.max(tapTarget, 116)}
                halo={hinting && d.object.id === target.id}
                found={found.includes(d.object.id)}
                returning={returning === d.object.id}
                onTap={(e) => void tap(d.object, e)}
              />
            </div>
          ))}
        </div>
      )}

      {layer}
    </GameShell>
  )
}

/* ------------------------------------------------------------ the object */

function ObjectLeaf({
  object,
  size,
  halo,
  found,
  returning,
  onTap,
}: {
  object: MeaningfulObject
  size: number
  halo: boolean
  found: boolean
  returning: boolean
  onTap(e: React.MouseEvent): void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={`petal-card flex flex-col items-center justify-center gap-1 ${returning ? 'returning' : ''}`}
      data-state={found ? 'correct' : returning ? 'returning' : undefined}
      style={{
        width: size,
        height: size,
        boxShadow: halo && !found ? '0 0 26px rgba(232,200,74,0.5)' : undefined,
        borderColor: halo && !found ? 'rgba(232,200,74,0.6)' : undefined,
      }}
    >
      {object.imageUrl ? (
        <img src={object.imageUrl} alt="" style={{ width: size * 0.5, height: size * 0.5, objectFit: 'cover', borderRadius: '42%' }} />
      ) : (
        <span style={{ fontSize: size * 0.34 }} aria-hidden="true">
          {object.glyph ?? '🪷'}
        </span>
      )}
      <span style={{ fontSize: 15, color: 'var(--chalk)' }}>{object.name}</span>
    </button>
  )
}

/** Progress dots. Never a fraction, never a percentage. */
export function Progress({ total, done }: { total: number; done: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: i < done ? 'var(--gold)' : 'rgba(221,234,248,0.22)',
            transition: 'background 900ms ease-in-out',
          }}
        />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- helpers */

function describe(cluster: SemanticCluster): string {
  return {
    MUSICAL: 'one that makes music',
    NATURE: 'one that grows',
    DAILY_LIFE: 'one from the house',
    CRAFT: 'one that was woven',
    FOOD: 'one you can eat',
  }[cluster]
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
