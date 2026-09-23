import { useEffect, useState } from 'react'

/**
 * A lotus opening.
 *
 * This is the entire reward vocabulary of Smaran. There is no "CORRECT!", no
 * confetti, no score popping up, no fanfare. A flower opens where she touched,
 * and the sound is a petal. That is all that ever happens when she is right.
 */

export function PetalBurst({ x, y, seed = 0 }: { x: number; y: number; seed?: number }) {
  return (
    <svg
      className="petal-burst"
      width="180"
      height="180"
      viewBox="0 0 180 180"
      style={{ position: 'fixed', left: x - 90, top: y - 90, zIndex: 60 }}
      aria-hidden="true"
    >
      {[0, 51, 102, 153, 204, 255, 306].map((deg, i) => (
        <path
          key={i}
          d="M90,90 C84,66 86,44 90,30 C94,44 96,66 90,90 Z"
          fill="var(--lotus-white)"
          fillOpacity={0.22}
          stroke="var(--lotus-white)"
          strokeWidth="1.1"
          transform={`rotate(${deg + seed} 90 90)`}
        />
      ))}
      <circle cx="90" cy="90" r="7" fill="var(--gold)" opacity="0.85" />
    </svg>
  )
}

/** Ripple rings, for a tap that landed on the water rather than on an answer. */
export function TapRipple({ x, y }: { x: number; y: number }) {
  return <span className="tap-ripple" style={{ left: x - 30, top: y - 30, width: 60, height: 60, position: 'fixed', zIndex: 55 }} aria-hidden="true" />
}

export interface BloomLayerHandle {
  burst(x: number, y: number): void
}

/**
 * Host for transient blooms. Keeps them mounted for their full 2.4s and then
 * forgets them — nothing here ever needs cleaning up by the caller.
 */
export function useBloomLayer() {
  const [blooms, setBlooms] = useState<{ id: number; x: number; y: number }[]>([])

  const burst = (x: number, y: number) => {
    const id = Date.now() + Math.random()
    setBlooms((b) => [...b, { id, x, y }])
    window.setTimeout(() => setBlooms((b) => b.filter((e) => e.id !== id)), 2600)
  }

  const layer = (
    <>
      {blooms.map((b) => (
        <PetalBurst key={b.id} x={b.x} y={b.y} seed={(b.id % 7) * 11} />
      ))}
    </>
  )

  return { burst, layer }
}

/**
 * The milestone moment: a bloom the whole family is told about. Still quiet —
 * a slow fade, a single line of chalk, and it leaves by itself.
 */
export function MilestoneVeil({ show, onDone, text }: { show: boolean; onDone(): void; text: string }) {
  useEffect(() => {
    if (!show) return
    const id = window.setTimeout(onDone, 6000)
    return () => window.clearTimeout(id)
  }, [show, onDone])

  if (!show) return null

  return (
    <div
      className="plaque-fade fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
      style={{ background: 'radial-gradient(circle at 50% 45%, rgba(15,32,64,0.82), rgba(8,15,30,0.95))' }}
      onClick={onDone}
    >
      <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <path
            key={deg}
            d="M100,100 C92,70 94,44 100,26 C106,44 108,70 100,100 Z"
            fill="var(--lotus-white)"
            fillOpacity="0.18"
            stroke="var(--lotus-white)"
            strokeWidth="1.2"
            transform={`rotate(${deg} 100 100)`}
          />
        ))}
        <circle cx="100" cy="100" r="11" fill="var(--gold)" opacity="0.9" />
      </svg>
      <p className="inscription text-center font-serif italic" style={{ fontSize: 'clamp(22px, 3.4vw, 38px)', color: 'var(--gold-soft)' }}>
        {text}
      </p>
    </div>
  )
}
