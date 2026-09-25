import { useEffect, useState } from 'react'
import './pixelPond.css'

/**
 * The pixel-art pond.
 *
 * The scene is two layers, both drawn on a 360x203 grid and scaled up four
 * times. Underneath is `pixelScenery`, which holds the water, the hills, the
 * bamboo, the rocks and the lily pads and never changes. On top is everything
 * that moves: koi, ducks, dragonflies, fireflies, glints.
 *
 * Splitting it that way is what keeps the animation cheap. The scenery is one
 * static subtree the browser paints once; only the sprite layer is
 * recomposited. It is also how the original pixel artists worked.
 *
 * Every sprite below is drawn in source pixels — a `1` here is one pixel of
 * the 360x203 grid and four on screen — so nothing ever lands off-grid.
 */

export const STAGE_W = 1440
export const STAGE_H = 810

/** The artwork's own resolution, before the eightfold blow-up. */
const SRC_W = 360
const SRC_H = 203

/**
 * How the stage is fitted to the viewport.
 *
 * One scale for both axes, always: a non-uniform stretch would put the pixel
 * grid out of square, and rectangular "pixels" are the one thing this style
 * cannot survive. The stage covers the viewport and is then capped so nothing
 * below `SAFE_H` — the hint under the voice stone — is ever cut off.
 */
const EASE_OFF = 0.98
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

/* -------------------------------------------------------------------------
   Sprites. Each is a two-frame cel where it needs to flutter, drawn once and
   placed by its caller, so a koi costs two paths rather than two images.
   ------------------------------------------------------------------------- */

/** One koi. `patch` is the colour of its markings; the body is always pale. */
function Koi({ patch, cel }: { patch: string; cel: 'a' | 'b' }) {
  // The tail is the only part that differs between frames — the body holds
  // still and the tail sweeps, which is how a carp actually swims.
  const tail =
    cel === 'a'
      ? 'M0 1h2v1h-2zM1 2h2v1h-2zM2 3h1v1h-1zM1 4h2v1h-2zM0 5h2v1h-2z'
      : 'M1 1h1v1h-1zM0 2h3v1h-3zM1 3h2v1h-2zM0 4h3v1h-3zM1 5h1v1h-1z'
  return (
    <g className={cel === 'a' ? 'px-fa' : 'px-fb'}>
      <path fill="#c9d6ef" d="M7 0h1v1h-1zM13 0h1v1h-1zM7 6h1v1h-1zM13 6h1v1h-1z" />
      <path fill="#c9d6ef" d={tail} />
      <path
        fill="#f3efe6"
        d="M5 1h2v1h-2zM10 1h3v1h-3zM3 2h4v1h-4zM11 2h2v1h-2zM3 3h6v1h-6zM11 3h3v1h-3zM3 4h12v1h-12zM5 5h10v1h-10z"
      />
      <path
        fill={patch}
        d="M7 1h3v1h-3zM13 1h2v1h-2zM7 2h4v1h-4zM13 2h4v1h-4zM9 3h2v1h-2zM14 3h4v1h-4zM15 4h2v1h-2z"
      />
      <path fill="#1c1a24" d="M17 2h1v1h-1zM17 4h1v1h-1z" />
    </g>
  )
}

/** One dragonfly. The wings beat five times faster than anything else moves. */
function Dragonfly({ body, head, cel }: { body: string; head: string; cel: 'a' | 'b' }) {
  const wings =
    cel === 'a'
      ? 'M6 0h1v1h-1zM8 0h1v1h-1zM7 1h2v1h-2zM7 3h2v1h-2zM6 4h1v1h-1zM8 4h1v1h-1z'
      : 'M6 1h3v1h-3zM6 3h3v1h-3z'
  return (
    <g className={cel === 'a' ? 'px-wa' : 'px-wb'}>
      <path fill="#cfeeff" d={wings} />
      <path fill={body} d="M0 2h8v1h-8z" />
      <path fill={body} d="M8 2h1v1h-1z" />
      <path fill={head} d="M9 2h2v1h-2z" />
    </g>
  )
}

/**
 * A duckling, drawn from its own top-left rather than its head.
 *
 * Exported so Duck Roll Call can reuse this exact sprite rather than redraw
 * it — the same duckling the pond already knows her by.
 */
export function Duckling({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="px-bob" style={{ animationDelay: `${delay}s` }}>
        <path
          fill="#6f5130"
          d="M4 0h3v1h-3zM3 1h1v1h-1zM1 3h2v1h-2zM0 4h1v1h-1zM2 4h3v1h-3zM0 5h1v1h-1zM2 5h2v1h-2z"
        />
        <path
          fill="#f6df72"
          d="M4 1h2v1h-2zM7 1h1v1h-1zM3 2h4v1h-4zM4 3h3v1h-3zM1 4h1v1h-1zM5 4h3v1h-3zM1 5h1v1h-1zM4 5h5v1h-5zM1 6h7v1h-7z"
        />
        <path fill="#111118" d="M6 1h1v1h-1z" />
        <path fill="#d99a3e" d="M7 2h2v1h-2z" />
        <path fill="#c9a03a" d="M2 7h5v1h-5z" />
      </g>
    </g>
  )
}

/** The mother duck, riding lower in the water than her ducklings. Exported for reuse. */
export function Duck({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="px-bob" style={{ animationDelay: `${delay}s` }}>
        <path fill="#2f7c6e" d="M13 0h3v1h-3zM12 1h5v1h-5zM12 2h2v1h-2zM15 2h1v1h-1z" />
        <path fill="#111118" d="M14 2h1v1h-1z" />
        <path fill="#e3b53e" d="M16 2h3v1h-3zM16 3h2v1h-2z" />
        <path fill="#8a6848" d="M12 3h4v1h-4zM13 4h3v1h-3z" />
        <path fill="#f3efe6" d="M13 5h3v1h-3z" />
        <path fill="#2c2a30" d="M1 6h2v1h-2zM0 7h2v1h-2z" />
        <path fill="#8a4a2c" d="M12 6h4v1h-4zM12 7h5v1h-5zM12 8h5v1h-5zM13 9h4v1h-4zM13 10h3v1h-3zM14 11h1v1h-1z" />
        <path fill="#3b2a1d" d="M2 7h1v1h-1zM1 8h1v1h-1zM1 9h1v1h-1zM1 10h1v1h-1zM2 11h1v1h-1zM4 12h11v1h-11z" />
        <path fill="#8d7458" d="M3 7h9v1h-9zM2 8h2v1h-2zM10 8h2v1h-2zM2 9h1v1h-1zM11 9h2v1h-2z" />
        <path fill="#6e5238" d="M4 8h6v1h-6zM3 9h4v1h-4zM9 9h2v1h-2z" />
        <path fill="#3a62d4" d="M7 9h2v1h-2z" />
        <path fill="#b8a58a" d="M2 10h11v1h-11zM3 11h11v1h-11z" />
      </g>
    </g>
  )
}

/* -------------------------------------------------------------------------
   Placement. The jugnus and glints are hand-placed rather than generated:
   they are scattered to sit in the dark pockets between the bamboo, which no
   random distribution finds on its own.
   ------------------------------------------------------------------------- */

/**
 * [x, y, drift track, drift delay, blink delay, blink duration]
 *
 * These belong over the grassland, which is where fireflies are: in the dark
 * pockets under the bamboo and low over the reeds, not out across open water.
 * They are hand-placed for that reason — a random scatter puts half of them in
 * the sky.
 */
const JUGNUS: [number, number, 0 | 1 | 2, number, number, number][] = [
  [21, 96, 0, -6.8, -0.4, 2.1],
  [37, 88, 1, -5.9, -2.6, 3.1],
  [12, 108, 2, -0.0, -2.3, 2.1],
  [46, 101, 0, -6.8, -1.0, 3.0],
  [26, 119, 1, -1.1, -2.8, 2.5],
  [58, 112, 2, -4.6, -1.6, 2.1],
  [9, 131, 0, -4.1, -2.9, 2.6],
  [44, 134, 1, -1.1, -0.9, 2.8],
  [64, 126, 2, -5.2, -0.3, 2.9],
  [312, 94, 0, -0.6, -0.6, 2.9],
  [344, 106, 1, -5.6, -0.4, 3.1],
  [327, 116, 2, -5.8, -0.1, 2.2],
  [305, 124, 0, -5.5, -2.6, 2.8],
  [339, 90, 1, -5.9, -1.7, 1.8],
  [351, 129, 2, -6.9, -1.2, 3.1],
  [318, 138, 0, -2.2, -2.1, 2.4],
  [86, 104, 0, -1.3, -1.5, 2.8],
  [112, 118, 1, -6.8, -1.6, 2.6],
  [138, 108, 2, -5.5, -2.6, 2.0],
  [163, 124, 0, -7.1, -1.1, 2.1],
  [191, 112, 1, -1.6, -2.8, 2.8],
  [217, 127, 2, -3.0, -1.8, 1.8],
  [244, 109, 0, -0.9, -0.7, 2.2],
  [271, 121, 1, -6.5, -0.9, 2.2],
  [129, 138, 2, -4.1, -0.2, 2.3],
  [178, 141, 0, -4.5, -1.3, 2.3],
  [236, 136, 1, -6.2, -1.7, 1.9],
  [96, 142, 2, -2.6, -2.4, 2.7],
]

/** [x, y, delay] — three-pixel flecks of moonlight, all below the waterline. */
const GLINTS: [number, number, number][] = [
  [122, 173, -1.8],
  [83, 165, -0.2],
  [133, 182, -0.9],
  [60, 190, -0.9],
  [203, 191, -0.8],
  [326, 163, -2.2],
  [155, 166, -0.2],
  [248, 183, -2.1],
  [174, 199, -1.2],
  [96, 158, -0.5],
]

/** [x, y, bob delay] */
const DUCKLINGS: [number, number, number][] = [
  [232, 174, -0.0],
  [219, 173, -0.3],
  [206, 174, -0.6],
  [226, 179, -0.15],
  [213, 180, -0.45],
  [200, 179, -0.75],
]

export interface PixelPondProps {
  /** Dim the scene behind a dialogue, without ever removing it. */
  recede?: boolean
}

export default function PixelPond({ recede = false }: PixelPondProps) {
  return (
    <div style={{ opacity: recede ? 0.34 : 1, transition: 'opacity 1.6s steps(6)' }}>
      <svg
        width={STAGE_W}
        height={SRC_H * 4}
        viewBox={`0 0 ${SRC_W} ${SRC_H}`}
        shapeRendering="crispEdges"
        className="px-overlay"
        aria-hidden="true"
      >
        {/* The pond itself — sky, moon, hills, bamboo, water, rocks, lilies.
            The reference artwork itself, pixel for pixel, not a redraw. */}
        <image
          href="/pond-pixel.png"
          x={0}
          y={0}
          width={SRC_W}
          height={SRC_H}
          style={{ imageRendering: 'pixelated' }}
        />

        {/* --- koi, gliding under the pads --- */}
        <g transform="translate(88 188)" opacity="0.92">
          <g className="px-swim-a">
            <Koi patch="#ec7a2a" cel="a" />
            <Koi patch="#ec7a2a" cel="b" />
          </g>
        </g>
        {/* Mirrored, so this one swims the other way without a second sprite. */}
        <g transform="translate(266 165) scale(-1 1)" opacity="0.92">
          <g className="px-swim-b">
            <Koi patch="#2a2230" cel="a" />
            <Koi patch="#2a2230" cel="b" />
          </g>
        </g>

        {/* --- the duck and her six --- */}
        <g className="px-paddle">
          <path d="M196 186h72v1h-72z M206 188h52v1h-52z" fill="#9ab8ee" opacity="0.7" />
          {DUCKLINGS.map(([x, y, d]) => (
            <Duckling key={`${x}-${y}`} x={x} y={y} delay={d} />
          ))}
          <Duck x={245} y={173} delay={-0.2} />
        </g>

        {/* --- dragonflies --- */}
        <g transform="translate(112 126)">
          <g className="px-fly-a">
            <Dragonfly body="#3fb8c4" head="#4fd1c5" cel="a" />
            <Dragonfly body="#3fb8c4" head="#4fd1c5" cel="b" />
          </g>
        </g>
        <g transform="translate(286 134)">
          <g className="px-fly-b">
            <Dragonfly body="#d8553e" head="#e6784e" cel="a" />
            <Dragonfly body="#d8553e" head="#e6784e" cel="b" />
          </g>
        </g>
        <g transform="translate(76 108)">
          <g className="px-fly-c">
            <Dragonfly body="#6cc36a" head="#9be07a" cel="a" />
            <Dragonfly body="#6cc36a" head="#9be07a" cel="b" />
          </g>
        </g>

        {/* --- jugnus. A cross of soft light around one bright pixel. --- */}
        {JUGNUS.map(([x, y, track, driftDelay, blinkDelay, blinkDur]) => (
          <g key={`${x}-${y}-${blinkDelay}`} transform={`translate(${x} ${y})`}>
            <g className={`px-drift-${track}`} style={{ animationDelay: `${driftDelay}s` }}>
              <g
                className="px-blink"
                style={{ animationDelay: `${blinkDelay}s`, animationDuration: `${blinkDur}s` }}
              >
                <path d="M-1 0h3v1h-3z M0 -1h1v3h-1z" fill="#c7e85a" opacity="0.55" />
                <path d="M0 0h1v1h-1z" fill="#fffde0" />
              </g>
            </g>
          </g>
        ))}

        {/* --- moonlight on the water --- */}
        {GLINTS.map(([x, y, delay]) => (
          <path
            key={`${x}-${y}`}
            className="px-glint"
            style={{ animationDelay: `${delay}s` }}
            d={`M${x} ${y}h3v1h-3z`}
            fill="#d6e4ff"
          />
        ))}

      </svg>
    </div>
  )
}
