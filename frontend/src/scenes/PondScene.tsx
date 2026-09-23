import { useEffect, useState } from 'react'
import './pond.css'
import { POND_ART } from './pondArt'

/**
 * The pond, ported from the design file.
 *
 * The artwork is drawn at exactly 1440×810 and is never reflowed. Instead the
 * whole stage — scene and interface together — is scaled uniformly to cover
 * the viewport, which keeps the voice stone sitting on the water where it was
 * and the language flowers standing at the water's edge on every screen size.
 *
 * Its `<defs>` (`#lilyPink`, `#lilyWhite`, `#budPink`, `#budWhite`) stay
 * reachable by `<use href="#…">` from anywhere else on the page, which is how
 * the language flowers bloom.
 */

export const STAGE_W = 1440
export const STAGE_H = 810

/**
 * How the stage is fitted to the viewport.
 *
 * One scale, used for both axes: any difference between them stretches the
 * moon into an egg and the lilies into ovals, which is far more noticeable
 * than a sliver of gradient at the edge.
 *
 * So the stage covers the viewport, top-anchored, and is then capped so that
 * everything down to `SAFE_H` stays on screen — the hint under the voice stone
 * is the lowest thing that must never be cut. On an ordinary 16:9 screen the
 * cap is slack and the scene bleeds edge to edge; only on unusually wide
 * windows does it bite, and then the gradient behind the stage carries the
 * last few pixels at the sides.
 */
const EASE_OFF = 0.98
/** The lowest stage row that must stay visible: the voice hint under the stone. */
const SAFE_H = 775

export function useStageScale(): number {
  const fitTo = (w: number, h: number) =>
    Math.min(Math.max(w / STAGE_W, h / STAGE_H), h / SAFE_H) * EASE_OFF
  const [scale, setScale] = useState(() =>
    typeof window === 'undefined' ? EASE_OFF : fitTo(window.innerWidth, window.innerHeight),
  )
  useEffect(() => {
    const onResize = () => setScale(fitTo(window.innerWidth, window.innerHeight))
    onResize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])
  return scale
}

export interface PondSceneProps {
  /** Dim the scene behind a dialogue, without ever removing it. */
  recede?: boolean
}

export default function PondScene({ recede = false }: PondSceneProps) {
  return (
    <svg
      width={STAGE_W}
      height={STAGE_H}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      className="pond-art"
      aria-hidden="true"
      style={{ opacity: recede ? 0.34 : 1, transition: 'opacity 1.6s ease-in-out' }}
      dangerouslySetInnerHTML={{ __html: POND_ART }}
    />
  )
}
