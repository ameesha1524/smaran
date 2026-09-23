import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GameShell, { SessionComplete } from '../components/GameShell'
import { useAdaptiveSession } from '../hooks/useAdaptiveSession'
import { useBloomLayer } from '../components/Bloom'
import { useSmaran } from '../state/SmaranContext'
import { demoRituals } from '../lib/demoData'
import { cue } from '../lib/ambient'
import { speak } from '../lib/speechEngine'
import './games.css'

/**
 * Morning Rituals — executive function and daily temporal orientation.
 *
 * A sunrise runs left to right across the screen and she puts her morning back
 * in order on it. A misplaced icon drifts softly home: no bounce, no buzz, no
 * red, no "wrong" — the only feedback for a misplacement is that the icon is
 * once again where it started.
 *
 * Both interactions work, because a hand with a tremor cannot always drag:
 *   · drag an icon onto the sunrise, or
 *   · touch an icon, then touch the place on the sunrise.
 */

export default function MorningRituals() {
  const { language, tapTarget } = useSmaran()
  const session = useAdaptiveSession('MORNING_RITUALS')
  const { burst, layer } = useBloomLayer()
  const navigate = useNavigate()

  const count = Math.min(demoRituals.length, Math.max(3, session.axes.choiceCount + 1))
  const items = useMemo(() => demoRituals.slice(0, count), [count])

  const [placed, setPlaced] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const slotRefs = useRef<(HTMLDivElement | null)[]>([])

  const placedCount = Object.keys(placed).length
  const allPlaced = placedCount === items.length

  useEffect(() => {
    session.markTargetShown()
    void speak('Put your morning back in order, from first light to late morning.', { language, rate: 0.82 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------ placement */

  const tryPlace = useCallback(
    (itemId: string, slotIndex: number, point: { x: number; y: number }) => {
      if (placed[slotIndex]) return
      const item = items.find((i) => i.id === itemId)
      if (!item) return
      session.recordTap()

      if (item.order === slotIndex + 1) {
        cue('petal')
        burst(point.x, point.y)
        setPlaced((p) => ({ ...p, [slotIndex]: itemId }))
        setSelected(null)
        return
      }

      // Softly back to where it came from.
      session.recordCorrection()
      setSelected(null)
      setReturning(itemId)
      window.setTimeout(() => setReturning(null), 950)
      if (session.axes.hintRichness >= 1) {
        void speak(`${item.label} comes a little ${item.order < slotIndex + 1 ? 'earlier' : 'later'}.`, {
          language,
          rate: 0.82,
        })
      }
    },
    [items, placed, session, burst, language],
  )

  /* --------------------------------------------------------------- drag */

  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (allPlaced) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setSelected(id)
    setDragging({ id, x: e.clientX, y: e.clientY })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragging({ ...dragging, x: e.clientX, y: e.clientY })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    const slot = slotRefs.current.findIndex((el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    })
    const id = dragging.id
    setDragging(null)
    // A press that never moved is a selection, not a failed drag.
    if (slot >= 0) tryPlace(id, slot, { x: e.clientX, y: e.clientY })
  }

  /* -------------------------------------------------------------- finish */

  useEffect(() => {
    if (!allPlaced || done) return
    const id = window.setTimeout(async () => {
      await session.finish(1)
      setDone(true)
    }, 2400)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPlaced, done])

  const restart = () => {
    setPlaced({})
    setSelected(null)
    setDone(false)
  }

  if (done) {
    return (
      <GameShell title="Morning Rituals" spoken="Your garden drank today." tag="Temporal orientation" videoRef={session.videoRef}>
        <SessionComplete
          blooms={items.length}
          domains={['Executive function', 'Daily temporal orientation']}
          onAgain={restart}
          onHome={() => navigate('/')}
          language={language}
        />
      </GameShell>
    )
  }

  const sunProgress = placedCount / items.length

  return (
    <GameShell
      title="Morning Rituals"
      spoken="Put your morning back in order, from first light to late morning."
      tag="Temporal orientation"
      videoRef={session.videoRef}
    >
      <div className="w-full select-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {/* -------------------------------------------------- the sunrise */}
        <div className="relative w-full" style={{ height: 150 }}>
          <svg width="100%" height="150" viewBox="0 0 900 150" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,140 C220,44 680,44 900,140" fill="none" stroke="var(--gold)" strokeWidth="1.4" opacity="0.35" strokeDasharray="4 8" />
            <path d="M0,148 L900,148" stroke="var(--chalk-dim)" strokeWidth="1" opacity="0.25" />
          </svg>

          {/* the sun, climbing as the order comes together */}
          <svg
            className="sun-climb"
            width="76"
            height="76"
            viewBox="0 0 76 76"
            style={{
              position: 'absolute',
              left: `calc(${6 + sunProgress * 84}% - 38px)`,
              top: 96 - Math.sin(sunProgress * Math.PI) * 78,
              opacity: 0.55 + sunProgress * 0.45,
            }}
            aria-hidden="true"
          >
            <circle cx="38" cy="38" r="30" fill="var(--gold)" opacity="0.18" />
            <circle cx="38" cy="38" r="19" fill="var(--gold-soft)" stroke="#050a12" strokeWidth="1" />
          </svg>

          <span className="absolute left-2 top-[120px] font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            first light
          </span>
          <span className="absolute right-2 top-[120px] font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            late morning
          </span>
        </div>

        {/* ---------------------------------------------------- the slots */}
        <div className="mt-2 flex w-full items-end justify-between gap-3">
          {items.map((_, i) => {
            const placedId = placed[i]
            const item = items.find((it) => it.id === placedId)
            return (
              <div
                key={i}
                ref={(el) => (slotRefs.current[i] = el)}
                onClick={(e) => selected && tryPlace(selected, i, { x: e.clientX, y: e.clientY })}
                className={`flex flex-1 flex-col items-center justify-center gap-1 ${placedId ? '' : 'slot-waiting'}`}
                style={{
                  minHeight: Math.max(tapTarget, 112),
                  borderRadius: '38% 38% 30% 30% / 26% 26% 22% 22%',
                  border: placedId ? '1px solid rgba(232,200,74,0.55)' : '1px dashed rgba(221,234,248,0.28)',
                  background: placedId ? 'rgba(232,200,74,0.08)' : 'rgba(11,23,40,0.4)',
                  transition: 'border-color 900ms ease-in-out, background 900ms ease-in-out',
                }}
              >
                {item ? (
                  <>
                    <span style={{ fontSize: 34 }} aria-hidden="true">
                      {item.glyph}
                    </span>
                    <span style={{ fontSize: 15, color: 'var(--chalk)' }}>{item.label}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>{ordinal(i + 1)}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* -------------------------------------------------- the icons */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          {items.map((item) => {
            const isPlaced = Object.values(placed).includes(item.id)
            if (isPlaced) return null
            return (
              <button
                key={item.id}
                type="button"
                onPointerDown={onPointerDown(item.id)}
                className={`petal-card flex flex-col items-center justify-center gap-1 px-4 py-3 ${returning === item.id ? 'returning' : ''}`}
                data-state={returning === item.id ? 'returning' : undefined}
                style={{
                  minWidth: Math.max(tapTarget, 124),
                  minHeight: Math.max(tapTarget, 112),
                  opacity: dragging?.id === item.id ? 0.3 : 1,
                  borderColor: selected === item.id ? 'rgba(232,200,74,0.65)' : undefined,
                  touchAction: 'none',
                }}
              >
                <span style={{ fontSize: 34 }} aria-hidden="true">
                  {item.glyph}
                </span>
                <span style={{ fontSize: 15, color: 'var(--chalk)' }}>{item.label}</span>
              </button>
            )
          })}
        </div>

        <p className="mt-6 text-center font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          {selected ? 'Now touch where it belongs on the sunrise.' : 'Touch something, then touch where it belongs.'}
        </p>
      </div>

      {/* the icon travelling with her finger */}
      {dragging && (
        <span
          style={{
            position: 'fixed',
            left: dragging.x - 30,
            top: dragging.y - 30,
            fontSize: 44,
            pointerEvents: 'none',
            zIndex: 70,
          }}
          aria-hidden="true"
        >
          {items.find((i) => i.id === dragging.id)?.glyph}
        </span>
      )}

      {layer}
    </GameShell>
  )
}

function ordinal(n: number): string {
  return ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][n - 1] ?? `${n}`
}
