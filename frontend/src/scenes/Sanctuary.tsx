import { useMemo } from 'react'
import './sanctuary.css'

/**
 * The sanctuary.
 *
 * This is not a background image with an interface on top of it. It is the
 * interface. Every layer below is hand-coded SVG, drawn back to front in the
 * order the eye should read it:
 *
 *   sky · stars · celestial body · hills · bamboo (3 depths per side) ·
 *   banana leaves · grasses · waterline · pond · shimmer · moon reflection ·
 *   lily pads · stemmed lotuses · ripples · koi · the sleeping figure · grain
 *
 * Nothing here is rectangular except the water, and the water is hidden behind
 * lily pads and a moon's reflection. Nothing blinks. Nothing flashes.
 */

export type DayPhase = 'night' | 'dawn' | 'day'

export interface SanctuaryProps {
  /** Night is rest, never failure. Dawn and day arrive as the garden is watered. */
  phase?: DayPhase
  /** 1 bare soil · 2 bamboo shoots · 3 orchids · 4 full grove. Drives bloom density. */
  bloomStage?: 1 | 2 | 3 | 4
  /** Force stillness regardless of the OS setting (a caregiver-controllable calm). */
  still?: boolean
  /** Dim the scene behind a game or a dialogue, without ever removing it. */
  recede?: boolean
  /** The resting woman on the large pad. Off on the home screen, where the
   *  greeting occupies the same part of the composition. */
  sleeper?: boolean
}

const VIEW_W = 1440
const VIEW_H = 900
const WATERLINE = 628

/** Deterministic noise. The pond must look the same every time she opens it. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PALETTE: Record<DayPhase, { top: string; bottom: string; hillFar: string; hillMid: string; hillNear: string; waterTop: string; waterBottom: string; bamboo: string[] }> = {
  night: {
    top: '#16265e',
    bottom: '#0a1230',
    hillFar: '#16264f',
    hillMid: '#123a24',
    hillNear: '#0e2c18',
    waterTop: '#1d4183',
    waterBottom: '#122a58',
    bamboo: ['#2a5c2a', '#3d7f33', '#56a340'],
  },
  dawn: {
    top: '#3a5a86',
    bottom: '#132743',
    hillFar: '#24405c',
    hillMid: '#284426',
    hillNear: '#1b3a1e',
    waterTop: '#1a3a5c',
    waterBottom: '#0d1c30',
    bamboo: ['#254528', '#335c33', '#4a6a32'],
  },
  day: {
    top: '#5d8aa4',
    bottom: '#1d3a52',
    hillFar: '#3d6076',
    hillMid: '#3a5c2c',
    hillNear: '#2b4a22',
    waterTop: '#27587e',
    waterBottom: '#12324a',
    bamboo: ['#2f5630', '#43703c', '#5a7840'],
  },
}

/* ------------------------------------------------------------------ bamboo */

interface Stalk {
  x: number
  height: number
  width: number
  lean: number
  joints: number[]
  delay: number
  duration: number
}

function buildStalks(seed: number, x0: number, x1: number, count: number, minH: number, maxH: number): Stalk[] {
  const rnd = mulberry32(seed)
  const stalks: Stalk[] = []
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * (i + rnd() * 0.7)) / count
    const height = minH + rnd() * (maxH - minH)
    const width = 7 + rnd() * 9
    const joints: number[] = []
    // A joint every 80–100px up the stalk — the mark that makes bamboo bamboo.
    for (let y = 90; y < height - 40; y += 80 + rnd() * 20) joints.push(y)
    stalks.push({
      x,
      height,
      width,
      lean: (rnd() - 0.5) * 16,
      joints,
      // Staggered so no two columns ever breathe together.
      delay: -rnd() * 6,
      duration: 4.1 + rnd() * 1.1,
    })
  }
  return stalks
}

function BambooStalk({ stalk, fill, opacity, baseY }: { stalk: Stalk; fill: string; opacity: number; baseY: number }) {
  const { x, height, width, lean, joints } = stalk
  const topX = x + lean
  const topY = baseY - height
  const half = width / 2

  return (
    <g
      className="bamboo-col"
      style={{ animationDelay: `${stalk.delay}s`, animationDuration: `${stalk.duration}s` }}
      opacity={opacity}
    >
      <path
        d={`M${x - half},${baseY} C${x - half},${baseY - height * 0.5} ${topX - half * 0.7},${topY + height * 0.3} ${topX - half * 0.6},${topY}
            L${topX + half * 0.6},${topY} C${topX + half * 0.7},${topY + height * 0.3} ${x + half},${baseY - height * 0.5} ${x + half},${baseY} Z`}
        fill={fill}
        stroke="#050a12"
        strokeWidth={1.2}
      />
      {joints.map((j, i) => {
        const p = j / height
        const jx = x + lean * p
        const jw = half * (1 - p * 0.35)
        return (
          <path
            key={i}
            d={`M${jx - jw},${baseY - j} Q${jx},${baseY - j - 4} ${jx + jw},${baseY - j}`}
            fill="none"
            stroke="#050a12"
            strokeWidth={1.1}
            opacity={0.8}
          />
        )
      })}
      {/* canopy leaves — folk-art outline, trembling on their own faster cycle */}
      <g className="bam-leaves" style={{ animationDelay: `${stalk.delay * 0.6}s` }}>
        {[-1, 1, -1, 1].map((dir, i) => {
          const ly = topY + i * 17
          const len = 44 + i * 7
          return (
            <path
              key={i}
              d={`M${topX},${ly} Q${topX + dir * len * 0.55},${ly - 20 - i * 2} ${topX + dir * len},${ly - 4} Q${topX + dir * len * 0.5},${ly + 8} ${topX},${ly}`}
              fill={fill}
              stroke="#050a12"
              strokeWidth={1}
              opacity={0.95}
            />
          )
        })}
      </g>
    </g>
  )
}

/* ------------------------------------------------------------- lily pads */

/**
 * The pad's outline, as a leaf rather than as a circle.
 *
 * A compass-drawn ellipse is the single biggest tell that a pad was generated:
 * real pads undulate, and the eye reads that undulation as "grown". The radius
 * is perturbed by three out-of-phase sine terms so the edge never repeats, and
 * the points are joined through their midpoints with quadratic curves so the
 * result stays smooth instead of faceted. The wedge from the centre is the
 * notch, and it opens toward the viewer.
 */
function organicPadPath(rx: number, ry: number, seed = 0, notchDeg = 30) {
  const wob = (t: number) =>
    1 + Math.sin(t * 3.1 + seed) * 0.055 + Math.cos(t * 5.3 + seed * 1.7) * 0.036 + Math.sin(t * 8.7 + seed * 0.6) * 0.022

  const half = (notchDeg / 2) * (Math.PI / 180)
  const start = Math.PI / 2 + half
  const end = Math.PI / 2 + Math.PI * 2 - half
  const steps = 46
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps
    const r = wob(t)
    pts.push([Math.cos(t) * rx * r, Math.sin(t) * ry * r])
  }

  let d = `M0,0 L${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    d += ` Q${px.toFixed(1)},${py.toFixed(1)} ${((px + cx) / 2).toFixed(1)},${((py + cy) / 2).toFixed(1)}`
  }
  return `${d} L${pts[pts.length - 1][0].toFixed(1)},${pts[pts.length - 1][1].toFixed(1)} Z`
}

/** The front arc of the rim, curling up to show the pad's paler underside. */
function padLipPath(rx: number, ry: number, seed = 0) {
  const wob = (t: number) =>
    1 + Math.sin(t * 3.1 + seed) * 0.055 + Math.cos(t * 5.3 + seed * 1.7) * 0.036 + Math.sin(t * 8.7 + seed * 0.6) * 0.022
  // Only the near third of the perimeter lifts — a pad curls where it is
  // unsupported, which from this angle is the edge closest to us.
  const from = Math.PI * 0.22
  const to = Math.PI * 0.78
  const steps = 22
  const outer: [number, number][] = []
  const inner: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    const r = wob(t)
    outer.push([Math.cos(t) * rx * r, Math.sin(t) * ry * r])
    // the inner boundary of the curl, pulled in and lifted
    inner.push([Math.cos(t) * rx * r * 0.84, Math.sin(t) * ry * r * 0.84 - 7.5])
  }
  const fwd = outer.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  const back = inner
    .slice()
    .reverse()
    .map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join('')
  return `${fwd}${back}Z`
}

export type LilyTone = 'white' | 'pink' | 'purple' | 'gold' | 'blue' | 'coral'

/**
 * A lily pad seen from the bank, not from above.
 *
 * `squash` is the whole trick: the pad's disc is scaled on Y only, so a pad far
 * across the water is a thin ellipse and one at our feet is a fat one. The
 * bloom on top is squashed far less, because a flower stands up out of the
 * water while the pad lies flat on it — foreshortening them equally is exactly
 * what made the old pads read as a top-down diagram.
 */
function LilyPad({
  x,
  y,
  scale = 1,
  squash = 0.5,
  rotate = 0,
  flower,
  delay = 0,
  dim = 0,
}: {
  x: number
  y: number
  scale?: number
  /** 0.3 far across the pond · 0.65 at the near edge. */
  squash?: number
  rotate?: number
  flower?: LilyTone | null
  delay?: number
  /** Haze for pads sitting further back in the water. */
  dim?: number
}) {
  const RX = 62
  const RY = 58
  const seed = ((x * 0.37 + y * 0.11) % 6.283) || 1.2
  const clipId = `padClip-${Math.round(x)}-${Math.round(y)}`
  const outline = organicPadPath(RX, RY, seed)
  // Many fine veins radiating from the notch, each forking near the rim — this
  // is most of what makes a pad read as drawn rather than as a green shape.
  const veins = [-76, -62, -48, -34, -20, -7, 7, 20, 34, 48, 62, 76]

  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} opacity={1 - dim}>
      {/* what the pad does to the water: a shadow under it and rings around it.
          The shadow is offset toward the viewer rather than centred, so the pad
          reads as floating on the surface instead of printed onto it. */}
      <g transform={`scale(${scale} ${scale * squash})`}>
        <ellipse cx={7} cy={34} rx={64} ry={30} fill="#040a14" opacity={0.36} />
        <ellipse cx={0} cy={20} rx={78} ry={44} fill="none" stroke="#a8ccf0" strokeWidth={1.4} opacity={0.18} />
        <ellipse cx={0} cy={20} rx={92} ry={52} fill="none" stroke="#a8ccf0" strokeWidth={1.1} opacity={0.09} />
      </g>

      {/* the pad itself, flattened into the water plane */}
      <g transform={`scale(${scale} ${scale * squash})`}>
        <defs>
          <clipPath id={clipId}>
            <path d={outline} />
          </clipPath>
        </defs>

        {/* the rim: a darker copy sitting a little lower, which is the pad's
            thickness seen edge-on */}
        <g transform="translate(0 3)">
          <path d={outline} fill="#123010" />
        </g>
        <path d={outline} fill="url(#padFace)" />

        {/* everything below is confined to the leaf's own silhouette */}
        <g clipPath={`url(#${clipId})`}>
          {/* directional light: dark at the back, warm where it faces us */}
          <path d={outline} fill="url(#padLight)" />

          {veins.map((deg, i) => {
            const rad = ((deg + 90) * Math.PI) / 180
            const ex = Math.cos(rad) * 60
            const ey = Math.sin(rad) * 56
            const fork = i % 2 === 0
            return (
              <g key={i} opacity={0.8}>
                <path d={`M0,2 Q${ex * 0.55},${ey * 0.52} ${ex},${ey}`} fill="none" stroke="#0d2712" strokeWidth={1.6} />
                {/* a paler line alongside each vein: the ridge catching moonlight */}
                <path d={`M1,2 Q${ex * 0.55 + 1},${ey * 0.52 - 1} ${ex},${ey - 1.5}`} fill="none" stroke="#7cbd66" strokeWidth={0.8} opacity={0.34} />
                {fork && (
                  <>
                    <path d={`M${ex * 0.68},${ey * 0.66} l${ex * 0.16},${ey * 0.08}`} fill="none" stroke="#0d2712" strokeWidth={1} />
                    <path d={`M${ex * 0.68},${ey * 0.66} l${ex * 0.1},${ey * 0.22}`} fill="none" stroke="#0d2712" strokeWidth={1} />
                  </>
                )}
              </g>
            )
          })}

          {/* mottling — a real pad is never one flat green */}
          <ellipse cx={-24} cy={-16} rx={16} ry={10} fill="#69b154" opacity={0.15} transform="rotate(-18 -24 -16)" />
          <ellipse cx={22} cy={-26} rx={11} ry={7} fill="#7cc062" opacity={0.12} />
          <ellipse cx={28} cy={14} rx={13} ry={8} fill="#0f2a14" opacity={0.2} />
          <ellipse cx={-34} cy={18} rx={9} ry={6} fill="#0f2a14" opacity={0.16} />
          {/* the shadow the bloom casts back down onto the leaf */}
          {flower && <ellipse cx={3} cy={-2} rx={34} ry={20} fill="#06180c" opacity={0.3} />}
        </g>

        {/* the near rim curls up and shows its paler underside */}
        <path d={padLipPath(RX, RY, seed)} fill="#a8d478" opacity={0.92} />
        <path d={padLipPath(RX, RY, seed)} fill="url(#padUnder)" />
        {/* the crease where the leaf bends up */}
        <path d={padLipPath(RX, RY, seed)} fill="none" stroke="#2f5e28" strokeWidth={0.9} opacity={0.45} />

        {/* a hard specular line where the waxy surface catches the moon */}
        <path d="M-46,-30 Q-8,-46 42,-28" fill="none" stroke="#bfe8a4" strokeWidth={1.6} opacity={0.3} strokeLinecap="round" />

        {/* the cut edges of the notch, kept inside the leaf's own silhouette */}
        <g clipPath={`url(#${clipId})`}>
          <path d={`M0,0 L-16,${RY * 0.96}`} stroke="#0c2210" strokeWidth={1.6} opacity={0.7} fill="none" />
          <path d={`M0,0 L16,${RY * 0.96}`} stroke="#0c2210" strokeWidth={1.6} opacity={0.7} fill="none" />
        </g>
      </g>

      {/* the bloom stands up out of the water: barely foreshortened at all,
          and larger than the pad's own scale would imply */}
      {flower && (
        <g transform={`scale(${scale * 1.38} ${scale * (0.62 + squash * 0.44)})`}>
          <WaterLily x={2} y={-6} tone={flower} delay={delay} />
        </g>
      )}
    </g>
  )
}

/**
 * A water lily, built the way the reference photographs are built: three rings
 * of petals at decreasing length and increasing lift, then a stamen cluster.
 * Thirty-odd separate petals is what stops it reading as a star or a splat.
 */
export function WaterLily({
  x,
  y,
  tone = 'white',
  scale = 1,
  delay = 0,
}: {
  x: number
  y: number
  tone?: LilyTone
  scale?: number
  delay?: number
}) {
  const TONES: Record<LilyTone, { fill: string; edge: string; shadow: string; glow: boolean; heart: string; stamen: string }> = {
    white: { fill: 'url(#pgWhite)', edge: '#8ea6c4', shadow: '#5e7a9c', glow: true, heart: '#f0c33e', stamen: '#f8de7a' },
    pink: { fill: 'url(#pgPink)', edge: '#a8356e', shadow: '#8a2a5e', glow: false, heart: '#f6d24a', stamen: '#fdf0a8' },
    purple: { fill: 'url(#pgPurple)', edge: '#5d3489', shadow: '#4a2870', glow: false, heart: '#f6d24a', stamen: '#fdf0a8' },
    gold: { fill: 'url(#pgGold)', edge: '#a9770f', shadow: '#8a6212', glow: true, heart: '#c8781e', stamen: '#ffeeb8' },
    blue: { fill: 'url(#pgBlue)', edge: '#37628d', shadow: '#2c527a', glow: true, heart: '#f6d24a', stamen: '#fdf0a8' },
    coral: { fill: 'url(#pgCoral)', edge: '#a54c29', shadow: '#8a3d20', glow: false, heart: '#f6d24a', stamen: '#fdf0a8' },
  }
  const c = TONES[tone]

  /**
   * A petal: base at the origin, reaching up to its tip, with a lean so the
   * spine is never perfectly straight. A symmetric almond repeated on an even
   * rotation is the thing that reads as generated rather than grown.
   */
  const petal = (len: number, wide: number, lean: number) => {
    const rad = (lean * Math.PI) / 180
    const tx = Math.sin(rad) * len
    const ty = -Math.cos(rad) * len
    // The widest point sits high on the petal and the shoulders stay full most
    // of the way to the tip — that broad, rounded blade is what separates a
    // water lily from a chrysanthemum.
    return (
      `M0,0 C${-wide},${(-len * 0.3).toFixed(1)} ${(-wide * 1.04 + tx * 0.35).toFixed(1)},${(-len * 0.7).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}` +
      ` C${(wide * 1.04 + tx * 0.35).toFixed(1)},${(-len * 0.7).toFixed(1)} ${wide},${(-len * 0.3).toFixed(1)} 0,0 Z`
    )
  }

  /**
   * Five rings from splayed to upright. `squash` is what builds the cup: the
   * outer ring is flattened so its petals lie out across the pad, and each ring
   * inward is rounder and lifted, so its petals stand up. Same trick as the pad,
   * used in the opposite direction.
   */
  const RINGS = [
    { count: 9, len: 37, wide: 11.5, offset: 0, squash: 0.5, lift: 5, op: 0.95 },
    { count: 8, len: 35, wide: 10.2, offset: 23, squash: 0.68, lift: 0, op: 0.97 },
    { count: 7, len: 31, wide: 8.6, offset: 27, squash: 0.84, lift: -6, op: 1 },
    { count: 6, len: 26, wide: 7, offset: 31, squash: 0.95, lift: -11, op: 1 },
    { count: 4, len: 19, wide: 5.4, offset: 42, squash: 1, lift: -15, op: 1 },
  ]

  // Deterministic per-petal variation, so a bloom is irregular but never
  // flickers between renders.
  const rnd = mulberry32(Math.round((x + 1) * 977 + (y + 1) * 131 + tone.length * 31))

  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} filter={c.glow ? 'url(#petalGlow)' : undefined}>
      <g className="lily-bloom" style={{ animationDelay: `${delay}s` }}>
        <ellipse cx={1} cy={8} rx={30} ry={9} fill="#04120a" opacity={0.32} />
        {RINGS.map((ring, ri) => (
          <g key={ri} transform={`translate(0 ${ring.lift}) scale(1 ${ring.squash})`} filter="url(#petalDrop)">
            {Array.from({ length: ring.count }, (_, i) => {
              const jitterLen = 1 + (rnd() - 0.5) * 0.17
              const jitterAng = (rnd() - 0.5) * 9
              const lean = (rnd() - 0.5) * 11
              return (
                <path
                  key={i}
                  d={petal(ring.len * jitterLen, ring.wide, lean)}
                  fill={c.fill}
                  stroke={c.edge}
                  strokeWidth={0.45}
                  opacity={ring.op}
                  transform={`rotate(${(360 / ring.count) * i + ring.offset + jitterAng})`}
                />
              )
            })}
          </g>
        ))}
        {/* stamens, sunk into the cup the inner rings have made */}
        <g transform="translate(0 -15)">
          <ellipse cx={0} cy={1} rx={6.4} ry={5} fill={c.shadow} opacity={0.5} />
          <circle cx={0} cy={0} r={5.2} fill={c.heart} />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (Math.PI * 2 * i) / 12 + 0.2
            return <circle key={i} cx={Math.cos(a) * 6.6} cy={Math.sin(a) * 5} r={1.4} fill={c.stamen} />
          })}
          <circle cx={0} cy={0} r={2.1} fill={c.shadow} opacity={0.45} />
        </g>
      </g>
    </g>
  )
}

/**
 * A closed lotus bud on its stem, standing at the water's edge. Solid petals
 * wrapped around each other rather than the old line-art star, which read as a
 * floating diagram once it sat over the dark grass.
 */
function LotusBud({ x, y, scale = 1, tone = 'white', delay = 0 }: { x: number; y: number; scale?: number; tone?: LilyTone; delay?: number }) {
  const fill = { white: '#e9f1fd', pink: '#f0a0c4', purple: '#c49ae8', gold: '#f6d87e', blue: '#a8cdee', coral: '#f7a382' }[tone]
  const edge = { white: '#9db4d0', pink: '#c05a8e', purple: '#7d52ad', gold: '#c39a2e', blue: '#5b8cb8', coral: '#b4552f' }[tone]
  return (
    // Two levels on purpose: a CSS transform animation on an element that also
    // carries a transform attribute silently discards the attribute, which puts
    // the bud at the origin instead of on its stem.
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="lotus-stemmed" style={{ animationDelay: `${delay}s` }}>
      {/* outer pair, curving away from the core */}
      <path d="M0,0 C-11,-9 -10,-24 -3,-33 C1,-23 2,-10 0,0 Z" fill={fill} stroke={edge} strokeWidth={0.8} opacity={0.9} />
      <path d="M0,0 C11,-9 10,-24 3,-33 C-1,-23 -2,-10 0,0 Z" fill={fill} stroke={edge} strokeWidth={0.8} opacity={0.9} />
      {/* the core, a tall closed almond */}
      <path d="M0,2 C-7,-8 -6,-26 0,-38 C6,-26 7,-8 0,2 Z" fill={fill} stroke={edge} strokeWidth={0.9} />
      <path d="M0,0 C-2.5,-12 -2.5,-26 0,-36" fill="none" stroke={edge} strokeWidth={0.6} opacity={0.6} />
      <circle cx={0} cy={-31} r={1.6} fill="#f6d24a" opacity={0.75} />
      </g>
    </g>
  )
}

/* ------------------------------------------------------------------- koi */

function Koi({
  className,
  x,
  y,
  scale,
  body,
  patch,
  delay,
}: {
  className: string
  x: number
  y: number
  scale: number
  body: string
  patch?: string
  delay: number
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={className} style={{ animationDelay: `${delay}s` }}>
        <ellipse cx={0} cy={6} rx={26} ry={7} fill="#040a14" opacity={0.28} />
        {/* tail — forked, tapering to two points rather than a fan */}
        <path
          d="M-20,0 C-30,-4 -34,-14 -46,-16 C-38,-6 -36,-2 -38,0 C-36,2 -38,6 -46,16 C-34,14 -30,4 -20,0 Z"
          fill={body}
          stroke="#050a12"
          strokeWidth={0.8}
          opacity={0.95}
        />
        {/* body — an almond/leaf silhouette: full through the middle, tapering to a point at the nose */}
        <path
          d="M28,0 C26,-6 16,-11 0,-11 C-14,-11 -22,-6 -24,0 C-22,6 -14,11 0,11 C16,11 26,6 28,0 Z"
          fill={body}
          stroke="#050a12"
          strokeWidth={0.9}
        />
        {patch && (
          <>
            <ellipse cx={-6} cy={-2} rx={9} ry={5} fill={patch} opacity={0.95} />
            <ellipse cx={12} cy={2} rx={6} ry={3.5} fill={patch} opacity={0.85} />
          </>
        )}
        {/* dorsal fin */}
        <path d="M-4,-9 Q2,-17 10,-8" fill="none" stroke="#050a12" strokeWidth={1} opacity={0.7} />
        {/* pectoral fin */}
        <path d="M2,7 Q8,14 16,8" fill="none" stroke="#050a12" strokeWidth={0.9} opacity={0.6} />
        {/* scale hints */}
        <ellipse cx={-10} cy={0} rx={5} ry={7} fill="none" stroke="#050a12" strokeWidth={0.5} opacity={0.3} />
        <ellipse cx={0} cy={0} rx={5} ry={7} fill="none" stroke="#050a12" strokeWidth={0.5} opacity={0.3} />
        <ellipse cx={10} cy={0} rx={5} ry={7} fill="none" stroke="#050a12" strokeWidth={0.5} opacity={0.3} />
        {/* eye + catchlight — small: a koi's eye is a bead, not a cartoon's */}
        <circle cx={19} cy={-2.4} r={1.3} fill="#050a12" />
        <circle cx={19.4} cy={-2.8} r={0.45} fill="#f0ede0" />
      </g>
    </g>
  )
}

/* ----------------------------------------------------------------- ducks */

function DuckBody({ scale = 1, fill = '#f0ede0', billFill = '#e0a53a' }: { scale?: number; fill?: string; billFill?: string }) {
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx={0} cy={0} rx={9} ry={6} fill={fill} stroke="#050a12" strokeWidth={0.6} />
      <circle cx={9} cy={-4} r={4.2} fill={fill} stroke="#050a12" strokeWidth={0.6} />
      <path d="M13,-4 L18,-3 L13,-1.5 Z" fill={billFill} stroke="#050a12" strokeWidth={0.4} />
      <circle cx={10.5} cy={-5} r={0.7} fill="#050a12" />
    </g>
  )
}

/** A mother duck with a line of ducklings paddling after her — one shared drift. */
function DuckFlotilla({ x, y, scale = 1, delay = 0 }: { x: number; y: number; scale?: number; delay?: number }) {
  const ducklings = [-20, -34, -46, -58, -70, -82, -94]
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="duck-flotilla" style={{ animationDelay: `${delay}s` }}>
        <ellipse cx={4} cy={5} rx={44} ry={7} fill="#040a14" opacity={0.22} />
        <g transform="translate(4 0)">
          <DuckBody scale={1.15} fill="#f2eee0" billFill="#e0a53a" />
        </g>
        {ducklings.map((dx, i) => (
          <g key={i} className="duck-bob" style={{ animationDelay: `${delay + i * 0.35}s` }} transform={`translate(${dx} ${i % 2 === 0 ? 3 : 5})`}>
            <DuckBody scale={0.55} fill="#f5da5a" billFill="#c9862f" />
          </g>
        ))}
      </g>
    </g>
  )
}

/* ------------------------------------------------------------ dragonflies */

function Dragonfly({
  x,
  y,
  hue,
  className,
  delay,
  scale = 1,
  flip = false,
}: {
  x: number
  y: number
  hue: string
  className: string
  delay: number
  scale?: number
  flip?: boolean
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className} style={{ animationDelay: `${delay}s` }}>
        <g transform={`scale(${flip ? -scale : scale} ${scale})`}>
          <g className="dfly-wings">
            {/* Four wings: glassy, so the scene shows through them. Anything
                more opaque than this reads as a pebble, not a wing. */}
            {[
              { cx: -6, cy: -8, rx: 22, ry: 5.5, rot: -14 },
              { cx: 10, cy: -8, rx: 22, ry: 5.5, rot: 14 },
              { cx: -7, cy: 3, rx: 17, ry: 4.2, rot: -9 },
              { cx: 9, cy: 3, rx: 17, ry: 4.2, rot: 9 },
            ].map((wg, i) => (
              <g key={i} transform={`rotate(${wg.rot} ${wg.cx} ${wg.cy})`}>
                <ellipse cx={wg.cx} cy={wg.cy} rx={wg.rx} ry={wg.ry} fill="#cfe8ff" opacity={0.13} />
                <ellipse cx={wg.cx} cy={wg.cy} rx={wg.rx} ry={wg.ry} fill="none" stroke="#dff0ff" strokeWidth={0.6} opacity={0.5} />
                {[-0.5, 0, 0.5].map((f, j) => (
                  <line
                    key={j}
                    x1={wg.cx - wg.rx * 0.9}
                    y1={wg.cy + wg.ry * f * 0.8}
                    x2={wg.cx + wg.rx * 0.9}
                    y2={wg.cy + wg.ry * f * 0.8}
                    stroke="#dff0ff"
                    strokeWidth={0.3}
                    opacity={0.3}
                  />
                ))}
              </g>
            ))}
          </g>
          {/* segmented abdomen, tapering to a point */}
          <path d="M0,-1.6 L22,-0.7 L27,0 L22,0.7 L0,1.6 Z" fill={hue} />
          {[6, 10, 14, 18].map((sx) => (
            <line key={sx} x1={sx} y1={-1.4} x2={sx} y2={1.4} stroke="#06101c" strokeWidth={0.6} opacity={0.5} />
          ))}
          {/* thorax and the big compound-eyed head */}
          <ellipse cx={-6} cy={0} rx={6} ry={4} fill={hue} />
          <ellipse cx={-6} cy={-1.4} rx={5} ry={2} fill="#ffffff" opacity={0.25} />
          <circle cx={-13} cy={0} r={3.4} fill={hue} />
          <circle cx={-14.4} cy={-1.2} r={1.3} fill="#06101c" opacity={0.75} />
          <circle cx={-12.4} cy={-1.6} r={1} fill="#ffffff" opacity={0.4} />
        </g>
      </g>
    </g>
  )
}

/* -------------------------------------------------------- sleeping figure */

function SleepingFigure() {
  return (
    <g className="sleeper" transform="translate(516 690)">
      {/* the pad she rests on, larger than the others */}
      <ellipse cx={0} cy={46} rx={126} ry={26} fill="#040a14" opacity={0.4} />
      <g transform="translate(0 30) scale(1.55)">
        <path d={organicPadPath(72, 34, 2.4)} fill="#2f5030" stroke="#050a12" strokeWidth={1.2} />
        {[-60, -30, 0, 30, 60].map((deg, i) => {
          const rad = ((deg + 90) * Math.PI) / 180
          return <line key={i} x1={0} y1={0} x2={Math.cos(rad) * 66} y2={Math.sin(rad) * 34} stroke="#0b1c12" strokeWidth={0.8} opacity={0.6} />
        })}
      </g>

      {/* sari drape — long curved paths, terracotta over olive */}
      <path
        d="M-68,26 C-52,-4 -14,-18 26,-12 C60,-7 82,6 86,26 C60,34 -34,36 -68,26 Z"
        fill="#c8773a"
        stroke="#050a12"
        strokeWidth={1.3}
      />
      <path d="M-58,22 C-30,6 6,0 44,8" fill="none" stroke="#e8c84a" strokeWidth={1.1} opacity={0.65} />
      <path d="M-46,28 C-18,14 18,9 56,16" fill="none" stroke="#f0ede0" strokeWidth={0.8} opacity={0.35} />
      {/* pallu falling toward the water */}
      <path d="M70,10 C86,16 92,30 84,42 C78,34 72,28 62,24 Z" fill="#b0632f" stroke="#050a12" strokeWidth={1.1} />

      {/* the arm trailing into the water */}
      <path d="M-56,18 C-76,24 -92,36 -100,50" fill="none" stroke="#e3b58b" strokeWidth={8} strokeLinecap="round" />
      <path d="M-100,50 l-5,7 M-100,50 l0,8 M-100,50 l5,7" stroke="#e3b58b" strokeWidth={2.4} strokeLinecap="round" fill="none" />
      {/* gold bangles */}
      <circle cx={-84} cy={33} r={5.4} fill="none" stroke="#e8c84a" strokeWidth={2} />
      <circle cx={-92} cy={40} r={5} fill="none" stroke="#e8c84a" strokeWidth={1.8} />

      {/* head, turned into the pad */}
      <g transform="translate(-30 -24)">
        <path d="M-34,10 C-40,-18 -22,-34 2,-32 C24,-30 34,-14 28,6 C18,20 -18,24 -34,10 Z" fill="#1a1016" stroke="#050a12" strokeWidth={1.1} />
        <ellipse cx={-4} cy={-2} rx={19} ry={17} fill="#e3b58b" stroke="#050a12" strokeWidth={0.9} />
        {/* serene closed eyes + a rested mouth */}
        <path d="M-14,-4 Q-9,1 -4,-4" fill="none" stroke="#3a2418" strokeWidth={1.4} strokeLinecap="round" />
        <path d="M2,-4 Q7,1 12,-4" fill="none" stroke="#3a2418" strokeWidth={1.4} strokeLinecap="round" />
        <path d="M-6,8 Q-2,11 3,8" fill="none" stroke="#a9694a" strokeWidth={1.2} strokeLinecap="round" />
        {/* maang tikka */}
        <line x1={-4} y1={-19} x2={-4} y2={-13} stroke="#e8c84a" strokeWidth={1.3} />
        <circle cx={-4} cy={-12} r={2.6} fill="#e8c84a" />
        {/* hair sweeping back over the pad */}
        <path d="M-30,-6 C-46,2 -56,16 -52,30 C-40,20 -30,14 -22,12" fill="#1a1016" stroke="#050a12" strokeWidth={1} />
      </g>
    </g>
  )
}

/* ------------------------------------------------------------- the scene */

export default function Sanctuary({
  phase = 'night',
  bloomStage = 1,
  still = false,
  recede = false,
  sleeper = false,
}: SanctuaryProps) {
  const pal = PALETTE[phase]

  const stars = useMemo(() => {
    const rnd = mulberry32(7)
    return Array.from({ length: 74 }, () => ({
      x: rnd() * VIEW_W,
      y: rnd() * 460,
      r: 0.5 + rnd() * 1.4,
      o: 0.25 + rnd() * 0.6,
    }))
  }, [])

  const leftFar = useMemo(() => buildStalks(11, -5, 130, 7, 420, 640), [])
  const leftMid = useMemo(() => buildStalks(23, -5, 175, 6, 520, 780), [])
  const leftNear = useMemo(() => buildStalks(41, 10, 200, 5, 640, 880), [])
  const rightFar = useMemo(() => buildStalks(53, 1320, 1445, 7, 420, 640), [])
  const rightMid = useMemo(() => buildStalks(67, 1275, 1445, 6, 520, 780), [])
  const rightNear = useMemo(() => buildStalks(83, 1240, 1430, 5, 640, 880), [])

  const grasses = useMemo(() => {
    const rnd = mulberry32(97)
    return Array.from({ length: 26 }, (_, i) => ({
      x: 40 + i * 54 + rnd() * 24,
      h: 26 + rnd() * 46,
      delay: -rnd() * 5,
      duration: 2.6 + rnd() * 1.2,
      curl: rnd() > 0.55,
    }))
  }, [])

  /**
   * Jugnus. Eight of them, and no two share anything — not a path, not a
   * speed, not a brightness, not a phase. Each gets its own generated keyframe
   * track of six wandering waypoints (the last equal to the first, so the loop
   * closes without a jump), which is what keeps them from reading as a single
   * synchronised effect. They cluster toward the middle of the frame, around
   * the greeting, rather than spreading evenly across it.
   */
  const jugnus = useMemo(() => {
    const rnd = mulberry32(131)
    return Array.from({ length: 8 }, (_, i) => {
      const hops = Array.from({ length: 5 }, () => ({
        dx: Math.round((rnd() - 0.5) * 190),
        dy: Math.round((rnd() - 0.5) * 130),
      }))
      return {
        id: i,
        // clustered on the centre, biased above the waterline
        x: 720 + (rnd() - 0.5) * 900,
        y: 300 + rnd() * 330,
        r: 1.7 + rnd() * 1.2,
        peak: 0.62 + rnd() * 0.38,
        driftDur: 17 + rnd() * 16,
        driftDelay: -rnd() * 26,
        pulseDur: 2.4 + rnd() * 3.2,
        pulseDelay: -rnd() * 6,
        // close the loop on the starting point
        track: [{ dx: 0, dy: 0 }, ...hops, { dx: 0, dy: 0 }],
      }
    })
  }, [])

  const jugnuKeyframes = useMemo(
    () =>
      jugnus
        .map((j) => {
          const stops = j.track
            .map((p, k) => `${Math.round((k / (j.track.length - 1)) * 100)}%{transform:translate(${p.dx}px,${p.dy}px)}`)
            .join('')
          return `@keyframes jugnuWander${j.id}{${stops}}`
        })
        .join('\n'),
    [jugnus],
  )

  // The garden fills the pond as it grows: bare soil has one bloom, a full grove
  // carries them across the water. Growth is visible without a single number.
  const bloomCount = { 1: 1, 2: 2, 3: 4, 4: 6 }[bloomStage]
  const isDay = phase === 'day'

  return (
    <div className={`sanctuary-shell ${still ? 'sanctuary-still' : ''}`} aria-hidden="true">
      <svg
        className="sanctuary"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: recede ? 0.34 : 1, transition: 'opacity 1.6s ease-in-out' }}
      >
        <defs>
          <radialGradient id="skyGrad" cx="62%" cy="18%" r="105%">
            <stop className="sky-stop" offset="0%" stopColor={pal.top} />
            <stop className="sky-stop" offset="62%" stopColor={pal.bottom} />
            <stop className="sky-stop" offset="100%" stopColor={pal.bottom} />
          </radialGradient>

          <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
            <stop className="sky-stop" offset="0%" stopColor={pal.waterTop} />
            <stop className="sky-stop" offset="100%" stopColor={pal.waterBottom} />
          </linearGradient>

          <radialGradient id="moonGrad" cx="38%" cy="34%" r="72%">
            <stop offset="0%" stopColor="#fdf6d8" />
            <stop offset="62%" stopColor="#f2d96a" />
            <stop offset="100%" stopColor="#e8c84a" />
          </radialGradient>

          <radialGradient id="sunGrad" cx="40%" cy="36%" r="70%">
            <stop offset="0%" stopColor="#fff3cf" />
            <stop offset="70%" stopColor="#f0b95a" />
            <stop offset="100%" stopColor="#d98b3a" />
          </radialGradient>

          <linearGradient id="padSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fbf7a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0b1c12" stopOpacity="0.1" />
          </linearGradient>

          {/* The lit face of a lily pad: moonlight from the upper left. */}
          <radialGradient id="padFace" cx="36%" cy="24%" r="86%">
            <stop offset="0%" stopColor="#5fae4c" />
            <stop offset="55%" stopColor="#428a37" />
            <stop offset="100%" stopColor="#2a5e2c" />
          </radialGradient>

          {/* A jugnu is a light source, not a yellow dot: core plus bloom. */}
          <filter id="jugnuGlow" x="-400%" y="-400%" width="900%" height="900%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Directional light across the pad: the back edge falls into shadow,
              the edge turned toward us picks up warmth. One light source, stated
              once, is most of what separates "dimensional" from "flat". */}
          <linearGradient id="padLight" x1="0.15" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#021007" stopOpacity="0.72" />
            <stop offset="40%" stopColor="#0d2a14" stopOpacity="0.2" />
            <stop offset="72%" stopColor="#a8dc86" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#d6f0b0" stopOpacity="0.42" />
          </linearGradient>

          {/* The underside of a curled rim is paler and yellower than the face. */}
          <linearGradient id="padUnder" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c6e79a" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#6fa551" stopOpacity="0.4" />
          </linearGradient>

          {/* Each petal ring drops a shadow onto the ring behind it. Depth in
              flat illustration is almost entirely this. */}
          <filter id="petalDrop" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2.4" stdDeviation="2.2" floodColor="#3d1030" floodOpacity="0.5" />
          </filter>

          {/* A petal is lit at the tip and falls into shadow at the throat. */}
          {[
            { id: 'pgWhite', base: '#8fa8c8', mid: '#e2ecfa', tip: '#ffffff' },
            { id: 'pgPink', base: '#a83a74', mid: '#ef8ebc', tip: '#ffd9ec' },
            { id: 'pgPurple', base: '#5f3690', mid: '#b98ce0', tip: '#ecdcfb' },
            { id: 'pgGold', base: '#b07d1c', mid: '#f4cc5e', tip: '#fff3c6' },
            { id: 'pgBlue', base: '#3c6c9e', mid: '#8fc0ea', tip: '#dcefff' },
            { id: 'pgCoral', base: '#b0532e', mid: '#f7a382', tip: '#ffe6d8' },
          ].map((g) => (
            <linearGradient key={g.id} id={g.id} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={g.base} />
              <stop offset="46%" stopColor={g.mid} />
              <stop offset="100%" stopColor={g.tip} />
            </linearGradient>
          ))}

          {/* Moonlight caught on a white bloom's petals. */}
          <filter id="petalGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Each petal ring is a gradient, lit at the tip and shaded at the throat. */}
          {[
            { id: 'petalWhite', lit: '#ffffff', mid: '#e6eefb', deep: '#a9bcd6' },
            { id: 'petalPink', lit: '#fbd0e4', mid: '#ef8ebc', deep: '#c04c8c' },
            { id: 'petalPurple', lit: '#e3d2f7', mid: '#b98ce0', deep: '#7a4ca8' },
            { id: 'petalGold', lit: '#ffeeb8', mid: '#f4cc5e', deep: '#c8952a' },
            { id: 'petalBlue', lit: '#d6e9fb', mid: '#8fc0ea', deep: '#4a7fb8' },
            { id: 'petalCoral', lit: '#ffdfd0', mid: '#f7a382', deep: '#c8613e' },
          ].map((g) => (
            <linearGradient key={g.id} id={g.id} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={g.deep} />
              <stop offset="55%" stopColor={g.mid} />
              <stop offset="100%" stopColor={g.lit} />
            </linearGradient>
          ))}

          {/* Gouache, not vector: a displacement wobble on every folk-art outline. */}
          <filter id="roughen" x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves={2} seed={4} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={7} xChannelSelector="R" yChannelSelector="G" />
          </filter>

          <filter id="roughenSoft" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={2} seed={9} result="n2" />
            <feDisplacementMap in="SourceGraphic" in2="n2" scale={3.5} xChannelSelector="R" yChannelSelector="G" />
          </filter>

          {/* Chalk/paper grain over the whole scene — no raster asset anywhere. */}
          <filter id="grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.86" numOctaves={3} stitchTiles="stitch" result="g" />
            <feColorMatrix type="saturate" values="0" />
          </filter>

          <filter id="softBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* ------------------------------------------------------------ sky */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#skyGrad)" />

        <g className="phase-fade" opacity={isDay ? 0.12 : 1}>
          {stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f0ede0" opacity={s.o} />
          ))}
        </g>

        {/* ------------------------------------------- moon, or the sun it becomes */}
        <g className="phase-fade" opacity={isDay ? 0 : 1}>
          <g className="moon">
            <circle cx={1096} cy={152} r={92} fill="#e8c84a" opacity={0.08} filter="url(#softBlur)" />
            <circle cx={1096} cy={152} r={58} fill="url(#moonGrad)" stroke="#050a12" strokeWidth={1.1} />
            {/* a sleepy face */}
            <path d="M1074,146 Q1081,153 1088,146" fill="none" stroke="#7a5f18" strokeWidth={2.4} strokeLinecap="round" />
            <path d="M1102,146 Q1109,153 1116,146" fill="none" stroke="#7a5f18" strokeWidth={2.4} strokeLinecap="round" />
            <path d="M1086,166 Q1096,174 1106,166" fill="none" stroke="#7a5f18" strokeWidth={2.2} strokeLinecap="round" />
          </g>
          <text className="zz" x={1160} y={104} fill="#f0ede0" opacity={0.6} fontSize={26} fontFamily="Playfair Display, serif" fontStyle="italic">
            z
          </text>
          <text className="zz" x={1180} y={84} fill="#f0ede0" opacity={0.45} fontSize={20} fontFamily="Playfair Display, serif" fontStyle="italic" style={{ animationDelay: '2.4s' }}>
            z
          </text>
        </g>

        <g className="phase-fade" opacity={isDay ? 1 : 0}>
          <g className="moon">
            <circle cx={1096} cy={152} r={108} fill="#f0b95a" opacity={0.14} filter="url(#softBlur)" />
            <circle cx={1096} cy={152} r={60} fill="url(#sunGrad)" stroke="#050a12" strokeWidth={1.1} />
            <path d="M1076,150 Q1083,144 1090,150" fill="none" stroke="#8a5a20" strokeWidth={2.2} strokeLinecap="round" />
            <path d="M1102,150 Q1109,144 1116,150" fill="none" stroke="#8a5a20" strokeWidth={2.2} strokeLinecap="round" />
            <path d="M1084,166 Q1096,177 1108,166" fill="none" stroke="#8a5a20" strokeWidth={2.2} strokeLinecap="round" />
          </g>
        </g>

        {/* ---------------------------------------------------------- hills */}
        <g filter="url(#roughen)">
          <path
            d={`M-20,470 C140,404 300,452 470,430 C640,408 760,352 940,392 C1120,432 1290,410 1460,440 L1460,${WATERLINE + 10} L-20,${WATERLINE + 10} Z`}
            fill={pal.hillFar}
            stroke="#050a12"
            strokeWidth={1.6}
          />
          <path
            d={`M-20,530 C160,480 340,528 520,506 C700,484 840,448 1010,486 C1180,524 1320,502 1460,522 L1460,${WATERLINE + 10} L-20,${WATERLINE + 10} Z`}
            fill={pal.hillMid}
            stroke="#050a12"
            strokeWidth={1.8}
          />
          <path
            d={`M-20,584 C180,548 360,586 560,570 C760,554 900,530 1080,562 C1250,592 1350,578 1460,588 L1460,${WATERLINE + 10} L-20,${WATERLINE + 10} Z`}
            fill={pal.hillNear}
            stroke="#050a12"
            strokeWidth={2}
          />
          {/* folk-art hill texture: scroll marks, not gradients */}
          {[
            'M180,556 q22,-12 44,0',
            'M300,566 q20,-11 40,0',
            'M1060,576 q22,-12 44,0',
            'M1180,586 q20,-11 40,0',
            'M620,540 q24,-13 48,0',
          ].map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#050a12" strokeWidth={1.2} opacity={0.5} />
          ))}
        </g>

        {/* ----------------------------------------- bamboo: three depths a side */}
        <g opacity={0.55}>
          {leftFar.map((s, i) => (
            <BambooStalk key={`lf${i}`} stalk={s} fill={pal.bamboo[0]} opacity={0.75} baseY={WATERLINE + 6} />
          ))}
          {rightFar.map((s, i) => (
            <BambooStalk key={`rf${i}`} stalk={s} fill={pal.bamboo[0]} opacity={0.75} baseY={WATERLINE + 6} />
          ))}
        </g>
        <g opacity={0.8}>
          {leftMid.map((s, i) => (
            <BambooStalk key={`lm${i}`} stalk={s} fill={pal.bamboo[1]} opacity={0.9} baseY={WATERLINE + 12} />
          ))}
          {rightMid.map((s, i) => (
            <BambooStalk key={`rm${i}`} stalk={s} fill={pal.bamboo[1]} opacity={0.9} baseY={WATERLINE + 12} />
          ))}
        </g>
        <g>
          {leftNear.map((s, i) => (
            <BambooStalk key={`ln${i}`} stalk={s} fill={pal.bamboo[2]} opacity={1} baseY={WATERLINE + 20} />
          ))}
          {rightNear.map((s, i) => (
            <BambooStalk key={`rn${i}`} stalk={s} fill={pal.bamboo[2]} opacity={1} baseY={WATERLINE + 20} />
          ))}
        </g>

        {/* --------------------------------------------- banana / broad leaves */}
        <g filter="url(#roughenSoft)">
          {[
            { x: 86, y: 470, rot: -18, s: 1, mirror: false, delay: 0 },
            { x: 44, y: 574, rot: 6, s: 1.2, mirror: false, delay: -1.7 },
            { x: 1362, y: 452, rot: 16, s: 1.05, mirror: true, delay: -2.6 },
            { x: 1404, y: 566, rot: -8, s: 1.25, mirror: true, delay: -0.9 },
          ].map((leaf, i) => (
            <g
              key={i}
              className={`banana-leaf ${leaf.mirror ? 'mirror' : ''}`}
              style={{ animationDelay: `${leaf.delay}s`, animationDuration: `${4.6 + i * 0.35}s` }}
              transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rot}) scale(${leaf.mirror ? -leaf.s : leaf.s} ${leaf.s})`}
            >
              <path
                d="M0,0 C6,-48 46,-96 128,-112 C104,-56 66,-12 0,0 Z"
                fill="#3a5c2c"
                stroke="#050a12"
                strokeWidth={1.5}
              />
              <path d="M0,0 C34,-34 78,-74 126,-110" fill="none" stroke="#050a12" strokeWidth={1.2} />
              {[0.18, 0.32, 0.46, 0.6, 0.74].map((p, j) => (
                <path
                  key={j}
                  d={`M${126 * p * 0.55},${-108 * p * 0.62} l${16 + j * 5},${-14 - j * 3}`}
                  fill="none"
                  stroke="#050a12"
                  strokeWidth={0.9}
                  opacity={0.6}
                />
              ))}
            </g>
          ))}
        </g>

        {/* ------------------------------------------------------------ jugnus */}
        {!isDay && (
          <g>
            <style>{jugnuKeyframes}</style>
            {jugnus.map((f) => (
              <g
                key={f.id}
                className="jugnu-drift"
                style={{ animation: `jugnuWander${f.id} ${f.driftDur}s ease-in-out ${f.driftDelay}s infinite` }}
              >
                <g
                  className="jugnu-pulse"
                  opacity={f.peak}
                  style={{ animation: `jugnuPulse ${f.pulseDur}s ease-in-out ${f.pulseDelay}s infinite` }}
                >
                  <circle cx={f.x} cy={f.y} r={f.r * 3.4} fill="#f2c94a" opacity={0.2} filter="url(#jugnuGlow)" />
                  <circle cx={f.x} cy={f.y} r={f.r * 1.7} fill="#f8dd78" opacity={0.5} />
                  <circle cx={f.x} cy={f.y} r={f.r} fill="#fff6c4" />
                </g>
              </g>
            ))}
          </g>
        )}

        {/* ------------------------------------------------------------ pond */}
        <rect x={0} y={WATERLINE} width={VIEW_W} height={VIEW_H - WATERLINE} fill="url(#waterGrad)" />
        {/* The far edge of the water is not a ruled line: the bank's reflection
            darkens it, and a pale band of sky sits just below the horizon. */}
        <rect x={0} y={WATERLINE} width={VIEW_W} height={16} fill="#0c2414" opacity={0.5} />
        <rect x={0} y={WATERLINE + 10} width={VIEW_W} height={26} fill="#8fc0ea" opacity={0.07} />

        {/* horizontal shimmer */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <ellipse
            key={i}
            className="shimmer-line"
            cx={180 + ((i * 197) % 1200)}
            cy={WATERLINE + 26 + i * 30}
            rx={130 + (i % 3) * 60}
            ry={1.6}
            fill="#ddeaf8"
            opacity={0.18}
            style={{ animationDelay: `${-i * 0.75}s`, animationDuration: `${3.6 + (i % 4) * 0.4}s` }}
          />
        ))}

        {/* the moon, lying on the water */}
        <ellipse cx={1096} cy={WATERLINE + 58} rx={52} ry={12} fill="#e8c84a" opacity={0.2} filter="url(#softBlur)" />
        <ellipse cx={1096} cy={WATERLINE + 96} rx={34} ry={7} fill="#e8c84a" opacity={0.12} filter="url(#softBlur)" />

        {/* --------------------------------------------- grasses at the waterline */}
        <g>
          {grasses.map((g, i) => (
            <g key={i} className="grass-tuft" style={{ animationDelay: `${g.delay}s`, animationDuration: `${g.duration}s` }}>
              <path
                d={`M${g.x},${WATERLINE + 8} C${g.x - 6},${WATERLINE - g.h * 0.5} ${g.x - 12},${WATERLINE - g.h * 0.8} ${g.x - 16},${WATERLINE - g.h}`}
                fill="none"
                stroke="#1f3a1c"
                strokeWidth={2}
                strokeLinecap="round"
              />
              <path
                d={`M${g.x + 4},${WATERLINE + 8} C${g.x + 8},${WATERLINE - g.h * 0.5} ${g.x + 14},${WATERLINE - g.h * 0.7} ${g.x + 20},${WATERLINE - g.h * 0.85}`}
                fill="none"
                stroke="#2b4a22"
                strokeWidth={2}
                strokeLinecap="round"
              />
              {g.curl && (
                // the scroll/curl motif from the folk-art reference
                <path
                  d={`M${g.x - 2},${WATERLINE + 6} c-10,-10 -2,-22 8,-18 c7,3 5,12 -2,11 c-4,-1 -4,-6 0,-6`}
                  fill="none"
                  stroke="#2b4a22"
                  strokeWidth={1.4}
                  opacity={0.85}
                />
              )}
            </g>
          ))}
        </g>

        {/* -------------------------------------------------------- lily pads */}
        {/* Three depth bands. Far pads are small, thin and hazed; near ones are
            large, rounder and run off the edges of the frame. Reading them in
            that order is what puts the viewer on the bank rather than overhead.
            Two blooms are always open — the garden's growth adds the rest
            rather than having to earn the first one. */}

        {/* far bank */}
        <LilyPad x={152} y={656} scale={0.55} squash={0.3} rotate={-5} dim={0.3} />
        <LilyPad x={436} y={648} scale={0.48} squash={0.28} rotate={8} dim={0.34} />
        <LilyPad x={982} y={660} scale={0.6} squash={0.3} rotate={-9} dim={0.28} />
        <LilyPad x={1292} y={650} scale={0.5} squash={0.28} rotate={6} dim={0.32} />

        {/* middle of the water */}
        <LilyPad x={84} y={720} scale={0.86} squash={0.44} rotate={-7} dim={0.12} flower="white" delay={-0.6} />
        <LilyPad x={274} y={748} scale={1.02} squash={0.46} rotate={-12} dim={0.08} flower="pink" delay={-2.1} />
        <LilyPad x={1148} y={710} scale={0.9} squash={0.44} rotate={8} dim={0.1} flower={bloomCount >= 2 ? 'white' : null} delay={-1.4} />
        <LilyPad x={742} y={768} scale={0.76} squash={0.42} rotate={-4} dim={0.14} />

        {/* the near edge, cropped by the frame */}
        <LilyPad x={-28} y={858} scale={1.42} squash={0.6} rotate={4} />
        <LilyPad x={338} y={892} scale={1.5} squash={0.62} rotate={-6} flower={bloomCount >= 4 ? 'white' : null} delay={-2.8} />
        <LilyPad x={1078} y={898} scale={1.34} squash={0.63} rotate={9} flower={bloomCount >= 6 ? 'pink' : null} />
        <LilyPad x={1474} y={848} scale={1.38} squash={0.6} rotate={-8} flower={bloomCount >= 3 ? 'pink' : null} delay={-3.2} />

        {/* ------------------- lotus buds standing along the water's edge ----
            These carry the waterline now that the language flowers are chosen
            once at first launch instead of living on this screen forever. */}
        {[
          { x: 186, base: 664, h: 62, s: 0.72, tone: 'white' as LilyTone, delay: 0 },
          { x: 392, base: 656, h: 52, s: 0.62, tone: 'pink' as LilyTone, delay: -1.3 },
          { x: 612, base: 668, h: 68, s: 0.78, tone: 'white' as LilyTone, delay: -2.6 },
          { x: 1042, base: 660, h: 56, s: 0.66, tone: 'pink' as LilyTone, delay: -0.8 },
          { x: 1268, base: 670, h: 64, s: 0.74, tone: 'white' as LilyTone, delay: -3.4 },
        ].map((l, i) => (
          <g key={i}>
            <path
              d={`M${l.x},${l.base} C${l.x - 9},${l.base - l.h * 0.45} ${l.x + 7},${l.base - l.h * 0.75} ${l.x},${l.base - l.h}`}
              fill="none"
              stroke="#3f6b2c"
              strokeWidth={2.2}
            />
            <LotusBud x={l.x} y={l.base - l.h} scale={l.s} tone={l.tone} delay={l.delay} />
            {/* one slow ripple where the stem enters the water */}
            <circle
              className="ripple"
              cx={l.x}
              cy={l.base}
              r={2}
              fill="none"
              stroke="#a8ccf0"
              strokeWidth={0.9}
              style={{ animationDelay: `${l.delay}s` }}
            />
          </g>
        ))}

        {/* -------------------------------------------------------------- koi */}
        <Koi className="koi-orange" x={306} y={790} scale={1.15} body="#d4762e" patch="#f6f0e4" delay={-2} />
        <Koi className="koi-cream" x={1060} y={846} scale={1.05} body="#f4efe2" patch="#c8433a" delay={-6} />
        <Koi className="koi-red" x={470} y={884} scale={0.95} body="#a8332c" patch="#f0e4d4" delay={-9} />

        {/* ------------------------------------------------------- ducks */}
        <DuckFlotilla x={906} y={742} scale={1.7} delay={-3} />

        {/* --------------- dragonflies, patrolling the reeds at the waterline */}
        <Dragonfly x={292} y={548} hue="#5ac0d8" className="dfly-1" delay={0} scale={1.35} />
        <Dragonfly x={470} y={598} hue="#4a8ae8" className="dfly-2" delay={-4} scale={1.15} />
        <Dragonfly x={1216} y={590} hue="#d0503a" className="dfly-3" delay={-8} scale={1.3} flip />

        {/* --------------------------------------------------- the sleeper */}
        {sleeper && <SleepingFigure />}

        {/* ------------------------------------------------- gouache grain */}
        <rect
          width={VIEW_W}
          height={VIEW_H}
          filter="url(#grain)"
          opacity={0.22}
          style={{ mixBlendMode: 'overlay', pointerEvents: 'none' }}
        />
      </svg>
    </div>
  )
}
