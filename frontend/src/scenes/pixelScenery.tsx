/**
 * pixelScenery.tsx — the pond itself: sky, moon, bamboo, vegetation, the rock
 * shoreline, water, lily pads and lotuses.
 *
 * The composition follows the reference artwork. The screen divides into three
 * bands: sky and moon on top, deep layered vegetation through the middle, and
 * water across the bottom quarter, with a shoreline of rocks and reeds where
 * the two meet.
 *
 * The vegetation is built as *masses* rather than as texture. A field of
 * individual grass strokes is the obvious way to fill this band and it is the
 * wrong one: at this resolution it reads as a repeating brush, because every
 * stroke is the same size and nothing occludes anything else. Real greenery
 * reads through overlapping silhouettes at different depths, so that is what
 * is drawn here — shrubs behind bushes behind bushes, each layer lit only
 * along the top edge of its own combined outline.
 *
 * Everything is static. It is kept apart from the sprites so the browser can
 * paint it once and leave it alone; only the moving layer is recomposited.
 *
 * All coordinates are source pixels: a `1` here is four pixels on screen.
 */

/* -------------------------------------------------------------------------
   Grid helpers. Each returns SVG path data built only from whole-pixel runs,
   so nothing can drift off-grid however it is composed.
   ------------------------------------------------------------------------- */

type Run = [x: number, y: number, w: number]
type Col = [x: number, y: number, w: number, h: number]
type Rand = () => number

/** Horizontal runs -> path data. One path per colour keeps the DOM small. */
const runs = (rs: Run[]) => rs.map(([x, y, w]) => `M${x} ${y}h${w}v1h${-w}z`).join('')

/** Vertical columns -> path data, for anything built from standing strips. */
const cols = (cs: Col[]) => cs.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('')

/**
 * A small deterministic PRNG.
 *
 * Vegetation, ripples and rocks are fields rather than compositions: what
 * matters is their density and silhouette, not where any one leaf lands.
 * Seeding it keeps the scene identical between renders and between machines,
 * so this is scatter without randomness in the part that counts.
 */
function rng(seed: number): Rand {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A filled circle, rasterised the way a pixel artist would step it. */
function discRuns(cx: number, cy: number, r: number): Run[] {
  const out: Run[] = []
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)))
    if (w <= 0) continue
    out.push([cx - w, cy + dy, w * 2 + 1])
  }
  return out
}

/** A filled ellipse. Bushes, rocks and lily pads are all built from this. */
function ellipseRuns(cx: number, cy: number, rx: number, ry: number): Run[] {
  const out: Run[] = []
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / (ry + 0.5)
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)))
    if (w <= 0) continue
    out.push([cx - w, cy + dy, w * 2 + 1])
  }
  return out
}

/**
 * The topmost pixel of every column in a shape.
 *
 * Lighting each ellipse's own top row would draw the seams between them and
 * give away how a bush was assembled. Taking the profile of the *whole* layer
 * instead means the highlight follows one continuous organic silhouette, which
 * is what makes separate blobs read as a single mass of leaves.
 */
function topEdge(rs: Run[]): Run[] {
  const top = new Map<number, number>()
  for (const [x, y, w] of rs) {
    for (let i = 0; i < w; i++) {
      const px = x + i
      const cur = top.get(px)
      if (cur === undefined || y < cur) top.set(px, y)
    }
  }
  return [...top.entries()].map(([x, y]): Run => [x, y, 1])
}

/**
 * One bush: several overlapping ellipses sharing a flat base.
 *
 * The lobes are what stop it reading as a dome. Each sits at its own height,
 * so the outline comes out bumpy the way a shrub is, and the bases line up so
 * the whole thing still sits on the ground.
 */
function clump(cx: number, cy: number, w: number, h: number, r: Rand): Run[] {
  const out: Run[] = []
  const n = 3 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const x = Math.round(cx - w / 2 + t * w)
    const rx = Math.max(2, Math.round(w / (n * 0.8)))
    const ry = Math.max(2, Math.round(h * (0.55 + r() * 0.6)))
    out.push(...ellipseRuns(x, cy - ry + 1, rx, ry))
  }
  return out
}

/** A fan of thin blades rising from one point — a tuft of reeds. */
function reedCluster(x: number, y: number, n: number, r: Rand): Run[] {
  const out: Run[] = []
  for (let k = 0; k < n; k++) {
    const lean = (k - (n - 1) / 2) * (0.22 + r() * 0.2)
    const h = 5 + Math.floor(r() * 9)
    for (let i = 0; i < h; i++) out.push([Math.round(x + lean * i), y - i, 1])
  }
  return out
}

/**
 * The classic 4x4 ordered-dither threshold matrix.
 *
 * A naive `(x + y) % n` test looks like a scatter but is not one: for any n
 * above 2 it lights whole diagonals, and a glow built that way comes out as
 * barber-pole stripes. Bayer's matrix spreads its thresholds so that no two
 * nearby pixels share one, which is what makes the result read as even mist.
 */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

/**
 * A dithered glow: the pixel-art answer to a soft halo.
 *
 * Stacking translucent discs bands into visible concentric rings, because each
 * disc has a hard edge. Fading by pixel *density* instead has no edges to
 * band — which is how this was done when there were only so many colours to go
 * round.
 */
function glowRuns(cx: number, cy: number, r0: number, r1: number): Run[] {
  const out: Run[] = []
  for (let y = cy - r1; y <= cy + r1; y++) {
    for (let x = cx - r1; x <= cx + r1; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d < r0 || d > r1) continue
      const t = 1 - (d - r0) / (r1 - r0)
      const threshold = (BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16
      if (t * t < threshold) continue
      out.push([x, y, 1])
    }
  }
  return out
}

/**
 * A silhouette quantised into four-pixel columns.
 *
 * The chunky step is the point: a smooth diagonal would read as vector art
 * even with antialiasing off, whereas a visible stair reads as something drawn
 * by hand at low resolution.
 */
function ridge(x0: number, x1: number, base: number, height: (x: number) => number, step = 4): Col[] {
  const out: Col[] = []
  for (let x = x0; x < x1; x += step) {
    const top = Math.round(height(x))
    out.push([x, top, Math.min(step, x1 - x), base - top])
  }
  return out
}

/* -------------------------------------------------------------------------
   The three horizons that fix the whole composition.
   ------------------------------------------------------------------------- */

const TREE_BASE = 82
const ROCK_LINE = 148
const WATER_TOP = 153

/* -------------------------------------------------------------------------
   Sky and moon
   ------------------------------------------------------------------------- */

const SKY_BANDS: [number, number, string][] = [
  [0, 14, '#0a0f2c'],
  [14, 28, '#0d1436'],
  [28, 42, '#111a42'],
  [42, 54, '#16214f'],
  [54, 64, '#1c2a5c'],
  [64, 74, '#233268'],
  [74, 84, '#2a3a74'],
]

/** [x, y, bright] — hand-scattered, and kept clear of the moon's halo. */
const STARS: [number, number, 0 | 1][] = [
  [14, 9, 1], [31, 5, 0], [48, 14, 0], [63, 7, 1], [82, 18, 0],
  [97, 6, 0], [112, 12, 1], [128, 4, 0], [141, 16, 0], [157, 9, 1],
  [172, 21, 0], [186, 6, 0], [201, 13, 1], [218, 8, 0], [233, 19, 0],
  [247, 5, 1], [262, 15, 0], [345, 52, 0], [21, 27, 0], [55, 33, 0],
  [88, 29, 1], [120, 38, 0], [151, 31, 0], [183, 41, 0], [214, 34, 1],
  [244, 44, 0], [266, 30, 0], [8, 44, 0], [40, 50, 0], [71, 46, 1],
  [104, 55, 0], [136, 49, 0], [166, 58, 0], [198, 52, 0], [229, 61, 0],
  [258, 54, 1], [124, 66, 0], [60, 62, 0], [180, 70, 0], [246, 68, 1],
  [96, 72, 0], [12, 66, 0], [212, 74, 0], [150, 76, 0], [36, 74, 0],
]

const MOON_X = 298
const MOON_Y = 27
const MOON_R = 13
/** Nothing is drawn inside this radius — see the note on the bamboo below. */
const MOON_HALO_R = MOON_R + 20

const MOON_HALO = runs(glowRuns(MOON_X, MOON_Y, MOON_R, MOON_HALO_R))

/**
 * The moon's face: closed eyes and a small smile.
 *
 * It is deliberately a cartoon rather than a rendered sphere. This screen is
 * the first thing a patient sees, often at night and often disoriented, and a
 * face that is asleep and content says "nothing is happening here" faster than
 * any amount of text. Craters would say the opposite.
 */
const MOON_EYES = runs([
  [MOON_X - 8, MOON_Y - 1, 1], [MOON_X - 7, MOON_Y - 2, 2], [MOON_X - 5, MOON_Y - 1, 1],
  [MOON_X + 4, MOON_Y - 1, 1], [MOON_X + 5, MOON_Y - 2, 2], [MOON_X + 7, MOON_Y - 1, 1],
])
const MOON_SMILE = runs([
  [MOON_X - 3, MOON_Y + 4, 1],
  [MOON_X - 2, MOON_Y + 5, 5],
  [MOON_X + 3, MOON_Y + 4, 1],
])
const MOON_BLUSH = runs([
  [MOON_X - 10, MOON_Y + 2, 3], [MOON_X - 10, MOON_Y + 3, 3],
  [MOON_X + 7, MOON_Y + 2, 3], [MOON_X + 7, MOON_Y + 3, 3],
])

/* -------------------------------------------------------------------------
   Bamboo

   Depth here comes from restraint. Two canes are lit; the other seven are
   near-silhouettes drawn under the vegetation, so the greenery grows up over
   their bases and they sit behind the scene rather than in front of it.

   Every stalk is placed clear of the moon's halo, which reaches x=331. The
   moon is the one clean focal point in the sky and a cane crossing it costs
   more than the cane is worth, so the right-hand group starts at x=334.
   ------------------------------------------------------------------------- */

/** [x, width] — dark canes, drawn under the vegetation. */
const BACK_STALKS: [number, number][] = [
  [3, 3], [16, 2], [27, 2], [47, 2],
  [334, 2], [352, 2], [358, 2],
]

/** [x, width] — the two that are actually lit, one on each side. */
const FRONT_STALKS: [number, number][] = [
  [34, 6],
  [343, 6],
]

const STALK_BOTTOM = 152

const BACK_BODY = cols(BACK_STALKS.map(([x, w]): Col => [x, 0, w, STALK_BOTTOM]))
const BACK_NODES = cols(
  BACK_STALKS.flatMap(([x, w], i): Col[] => {
    const out: Col[] = []
    for (let y = 8 + i * 3; y < STALK_BOTTOM; y += 17) out.push([x, y, w, 1])
    return out
  }),
)

const FRONT_BODY = cols(FRONT_STALKS.map(([x, w]): Col => [x, 0, w, STALK_BOTTOM]))
const FRONT_LIT = cols(FRONT_STALKS.map(([x, w]): Col => [x, 0, Math.max(1, w - 4), STALK_BOTTOM]))
const FRONT_DARK = cols(FRONT_STALKS.map(([x, w]): Col => [x + w - 1, 0, 1, STALK_BOTTOM]))

/** Segmented joints: a hard band every fifteen pixels is what makes it bamboo. */
const FRONT_NODES = cols(
  FRONT_STALKS.flatMap(([x, w], i): Col[] => {
    const out: Col[] = []
    for (let y = 11 + i * 6; y < STALK_BOTTOM; y += 15) {
      out.push([x - 1, y, w + 2, 1], [x - 1, y + 1, w + 2, 1])
    }
    return out
  }),
)

/** A leaf is a four-pixel stepped slash, hung off alternating sides. */
function leafRuns(x: number, y: number, left: boolean): Run[] {
  const ox = left ? x - 8 : x
  return [
    [ox + (left ? 4 : 0), y, 4],
    [ox + 2, y + 1, 4],
    [ox + (left ? 0 : 4), y + 2, 4],
  ]
}

const FRONT_LEAVES = runs(
  FRONT_STALKS.flatMap(([x, w], i) =>
    [18, 44, 67, 95].flatMap((y, n) => {
      const left = (n + i) % 2 === 0
      return leafRuns(left ? x : x + w, y + i * 5, left)
    }),
  ),
)
const BACK_LEAVES = runs(
  BACK_STALKS.flatMap(([x, w], i) =>
    [26, 58, 90].flatMap((y, n) => {
      const left = (n + i) % 2 === 0
      return leafRuns(left ? x : x + w, y + i * 4, left)
    }),
  ),
)

/* -------------------------------------------------------------------------
   Vegetation

   Four depth layers, each darker the further back it sits, and each lit only
   along the top of its own combined silhouette. The separation between them
   is what gives the band its depth; without it the whole middle of the screen
   flattens into one green rectangle.
   ------------------------------------------------------------------------- */

/** The treeline the vegetation stands against. */
const TREE_RIDGE = ridge(0, 360, TREE_BASE, (x) => 70 - 5 * Math.sin(x / 23) - 3 * Math.sin(x / 9 + 1))

/**
 * Muted greens throughout.
 *
 * These are far less saturated than a daylit garden would want. At night the
 * eye reads shape before hue, so saturation spent here buys nothing and costs
 * the contrast that the lotuses and the moon need in order to stay dominant.
 */
const GRASS_BANDS: [number, number, string][] = [
  [TREE_BASE, 100, '#122a1b'],
  [100, 120, '#163120'],
  [120, 138, '#1a3925'],
  [138, ROCK_LINE + 6, '#152d1d'],
]

const VEG = (() => {
  const r = rng(90210)
  const back: Run[] = []
  const mid: Run[] = []
  const front: Run[] = []
  const shore: Run[] = []
  const reeds: Run[] = []
  const shoreReeds: Run[] = []
  const flowers: { x: number; y: number; c: string }[] = []

  // The back layer is a continuous low wall of shrubs along the treeline —
  // the horizon that the rest of the greenery stands in front of.
  let x = -10
  while (x < 372) {
    const w = 11 + Math.floor(r() * 17)
    back.push(...clump(x + w / 2, 99 + Math.floor(r() * 4), w, 5 + Math.floor(r() * 6), r))
    x += w * (0.5 + r() * 0.25)
  }

  // Midground bushes: separated masses, so gaps of dark open up between them.
  for (let i = 0; i < 34; i++) {
    mid.push(
      ...clump(
        Math.floor(r() * 376) - 8,
        107 + Math.floor(r() * 22),
        14 + Math.floor(r() * 20),
        6 + Math.floor(r() * 7),
        r,
      ),
    )
  }

  // Foreground bushes: fewer and larger, gathered towards the water.
  for (let i = 0; i < 22; i++) {
    front.push(
      ...clump(
        Math.floor(r() * 376) - 8,
        131 + Math.floor(r() * 15),
        18 + Math.floor(r() * 24),
        7 + Math.floor(r() * 8),
        r,
      ),
    )
  }

  // Shoreline clumps, sitting low among the stones rather than behind them.
  //
  // These are placed as separated patches with real gaps, not as another
  // continuous wall. Planting the whole waterline closes over the stones and
  // loses the rocky edge entirely — the point is to break the rock line up,
  // not to replace it.
  let sx = -6
  while (sx < 370) {
    const w = 8 + Math.floor(r() * 14)
    shore.push(...clump(sx + w / 2, ROCK_LINE + 1 + Math.floor(r() * 4), w, 3 + Math.floor(r() * 4), r))
    sx += w + 9 + Math.floor(r() * 24)
  }

  for (let i = 0; i < 44; i++) {
    reeds.push(...reedCluster(Math.floor(r() * 360), 114 + Math.floor(r() * 30), 3 + Math.floor(r() * 4), r))
  }
  // Reeds along the waterline are what stop the rocks reading as a built wall.
  for (let i = 0; i < 40; i++) {
    shoreReeds.push(
      ...reedCluster(Math.floor(r() * 360), ROCK_LINE + 2 + Math.floor(r() * 5), 3 + Math.floor(r() * 5), r),
    )
  }

  // Flowers come in clusters, never singly — a lone dot reads as dirt.
  const petals = ['#d9cbe2', '#dda3b8', '#ddca8c', '#bdb2d4']
  for (let i = 0; i < 30; i++) {
    const cx = Math.floor(r() * 360)
    const cy = 100 + Math.floor(r() * 46)
    const c = petals[Math.floor(r() * petals.length)]
    const n = 3 + Math.floor(r() * 5)
    for (let k = 0; k < n; k++) {
      flowers.push({ x: cx + Math.floor(r() * 9) - 4, y: cy + Math.floor(r() * 6) - 3, c })
    }
  }

  return {
    back: runs(back),
    backRim: runs(topEdge(back)),
    mid: runs(mid),
    midRim: runs(topEdge(mid)),
    front: runs(front),
    frontRim: runs(topEdge(front)),
    shore: runs(shore),
    shoreRim: runs(topEdge(shore)),
    reeds: runs(reeds),
    shoreReeds: runs(shoreReeds),
    flowers,
  }
})()

/* -------------------------------------------------------------------------
   The rock shoreline

   The stones overlap into an unbroken edge, then vegetation is drawn over
   their bases so they sit *in* the bank rather than on top of it.
   ------------------------------------------------------------------------- */

const BOUNDARY = (() => {
  const r = rng(775511)
  const stones: [number, number, number, number][] = []
  let x = -6
  while (x < 366) {
    const rx = 4 + Math.floor(r() * 5)
    const ry = 3 + Math.floor(r() * 3)
    stones.push([x + rx, ROCK_LINE - 1 + Math.floor(r() * 4), rx, ry])
    x += rx + 1 + Math.floor(r() * 3)
  }
  return stones
})()

const ALL_STONES = BOUNDARY.flatMap(([x, y, rx, ry]) => ellipseRuns(x, y, rx, ry))
const ROCK_BODY = runs(ALL_STONES)
const ROCK_LIT = runs(topEdge(ALL_STONES))
const ROCK_SHADE = runs(BOUNDARY.flatMap(([x, y, rx, ry]) => ellipseRuns(x, y, rx, ry).slice(-2)))

/* -------------------------------------------------------------------------
   Water

   Dark, and quiet. The highlights are few and long rather than many and
   short: scattered flecks read as chop, and this pond is meant to be still.
   ------------------------------------------------------------------------- */

const WATER_BANDS: [number, number, string][] = [
  [WATER_TOP, 162, '#355a8a'],
  [162, 172, '#30537f'],
  [172, 184, '#2d4e7a'],
  [184, 194, '#284670'],
  [194, 203, '#233e63'],
]

const RIPPLES = (() => {
  const r = rng(31415)
  const bright: Run[] = []
  const soft: Run[] = []
  for (let i = 0; i < 64; i++) {
    const y = WATER_TOP + 2 + Math.floor(r() * (201 - WATER_TOP))
    const depth = (y - WATER_TOP) / (203 - WATER_TOP)
    const w = 8 + Math.floor(r() * (10 + depth * 22))
    const x = Math.floor(r() * (360 - w))
    ;(r() < 0.3 ? bright : soft).push([x, y, w])
  }
  return { bright: runs(bright), soft: runs(soft) }
})()

/** The moon's reflection, broken so it reads as light on water, not a spill. */
const MOONPATH = runs([
  [295, 155, 8], [293, 158, 12], [297, 161, 6], [292, 165, 14],
  [296, 169, 8], [290, 173, 17], [295, 178, 10], [288, 183, 19],
  [294, 189, 11], [286, 195, 21],
])

/* -------------------------------------------------------------------------
   Lily pads and lotuses
   ------------------------------------------------------------------------- */

/** [cx, cy, rx] — wide and flat, well spaced, as the reference draws them. */
const PADS: [number, number, number][] = [
  [44, 182, 25],
  [300, 178, 25],
  [110, 167, 14],
  [150, 195, 16],
  [236, 163, 13],
  [346, 193, 14],
  [14, 160, 13],
  [268, 198, 15],
]

/**
 * The lily pad silhouette, settled before any colour is chosen.
 *
 * Three things in the outline do the work, and no amount of shading afterwards
 * substitutes for any of them:
 *
 *  - It is close to twice as wide as it is tall. A pad seen from a standing
 *    person's eye-line is foreshortened hard, so anything near-circular reads
 *    as a ball floating in the pond.
 *  - The left lobe is slightly smaller than the right, and a tapering spur
 *    runs off the right flank. Perfect symmetry looks manufactured.
 *  - A V opens at the near edge and widens towards the viewer. That notch is
 *    the single most recognisable thing about the plant.
 */
function padRuns(cx: number, cy: number, rx: number): Run[] {
  const ry = Math.max(2, Math.round(rx * 0.52))
  const out: Run[] = []
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / (ry + 0.5)
    const half = rx * Math.sqrt(Math.max(0, 1 - t * t))
    const left = Math.floor(half * 0.9)
    let right = Math.floor(half)
    // The spur: widest just above the waist, tapering to a point either way.
    const spur = 1 - Math.abs(dy + 1) / (ry * 0.8)
    if (spur > 0) right += Math.round(rx * 0.26 * spur * spur)
    const w = left + right + 1
    if (w < 2) continue
    const y = cy + dy
    const x0 = cx - left
    if (dy <= 0) {
      out.push([x0, y, w])
      continue
    }
    const nt = dy / ry
    const gap = Math.round(rx * 0.34 * nt * nt)
    if (gap < 2 || w - gap < 4) {
      out.push([x0, y, w])
      continue
    }
    const side = Math.floor((w - gap) / 2)
    out.push([x0, y, side], [x0 + w - side, y, side])
  }
  return out
}

/**
 * Radial veins running out from the centre of a pad.
 *
 * They step along an ellipse rather than a circle, so they foreshorten with
 * the pad instead of fighting it, and they stop well short of the rim. Veins
 * that reach the edge cut the silhouette into slices.
 */
function veinRuns(cx: number, cy: number, rx: number): Run[] {
  if (rx < 11) return []
  const ry = Math.max(2, Math.round(rx * 0.52))
  const out: Run[] = []
  for (let k = 0; k < 9; k++) {
    // Fanning out and forwards, staying clear of the notch.
    const a = Math.PI * (1.1 + (k / 8) * 0.8)
    for (let d = 2; d < rx * 0.72; d++) {
      out.push([Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * (ry / rx)), 1])
    }
  }
  return out
}

/**
 * Four greens per pad, plus a specular.
 *
 * One fill and a rim highlight is flat, so the surface is split by row: the
 * far half catches the moon, the near half drops into shade, the last rows go
 * darkest, and a short run of pixels on the upper-left rim takes a bright
 * specular — the thing that says the leaf is wet.
 */
const PAD_LAYERS = (() => {
  const body: Run[] = []
  const light: Run[] = []
  const shadow: Run[] = []
  const rim: Run[] = []
  const spec: Run[] = []
  const veins: Run[] = []
  for (const [cx, cy, rx] of PADS) {
    const rs = padRuns(cx, cy, rx)
    const ry = Math.max(2, Math.round(rx * 0.52))
    body.push(...rs)
    for (const [x, y, w] of rs) {
      if (y < cy - ry * 0.15) light.push([x, y, w])
      if (y > cy + ry * 0.45) shadow.push([x, y, w])
    }
    // Per pad, never across the merged set: one shared profile would give the
    // rim only to whichever pad sits highest wherever two of them overlap.
    const edge = topEdge(rs)
    rim.push(...edge)
    spec.push(...edge.filter(([x]) => x > cx - rx * 0.62 && x < cx - rx * 0.2))
    veins.push(...veinRuns(cx, cy, rx))
  }
  return {
    body: runs(body),
    light: runs(light),
    shadow: runs(shadow),
    rim: runs(rim),
    spec: runs(spec),
    veins: runs(veins),
  }
})()

/**
 * One lotus petal, tip to base.
 *
 * Width follows a sine so the petal swells low and tapers to a point, and
 * `lean` slides the tip sideways while the base stays put — which is how a
 * ring of petals opens out from a single centre.
 */
function petalRuns(cx: number, baseY: number, h: number, w: number, lean: number): Run[] {
  const out: Run[] = []
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1)
    const hw = Math.round((w / 2) * Math.sin((Math.PI / 2) * Math.pow(t, 0.62)))
    const c = cx + Math.round(lean * (1 - t))
    out.push([c - hw, baseY - (h - 1) + i, hw * 2 + 1])
  }
  return out
}

interface Lotus {
  shadow: string
  dark: string
  mid: string
  light: string
  pale: string
  heart: string
}

/** Five values each, from the petals in deepest shade to the near-white core. */
const PINK: Lotus = {
  shadow: '#6e2445',
  dark: '#9c3a65',
  mid: '#c45c88',
  light: '#e793b4',
  pale: '#fbdcea',
  heart: '#f2cf6a',
}
const WHITE: Lotus = {
  shadow: '#4f5d7a',
  dark: '#74849f',
  mid: '#a3b1c8',
  light: '#d3dceb',
  pale: '#ffffff',
  heart: '#f2cf6a',
}

/**
 * Five rings of petals, back to front.
 *
 * Thirty-one petals here against nineteen before. The count is what makes a
 * lotus: it is a dense flower, and at this scale density can only come from
 * petal count, because there is no room to draw detail inside any one petal.
 *
 * The ordering is load-bearing. Each ring inwards stands taller and lighter,
 * and the outermost is the shortest while splaying widest — if the outer
 * petals are long as well as splayed, the silhouette spreads sideways and the
 * flower reads as a bird rather than a bloom.
 *
 * The heights compress as they go in (7, 10, 12, 14, 15) rather than climbing
 * evenly. An even climb builds a cone, and a cone with a pale tip reads as a
 * candle flame; compressing the last rings domes the bloom instead.
 */
function lotusLayers(cx: number, baseY: number) {
  return {
    shadow: runs([-20, -15, -10, -5, 5, 10, 15, 20].flatMap((l) => petalRuns(cx, baseY, 7, 11, l))),
    dark: runs([-16, -11, -6, -2, 2, 6, 11, 16].flatMap((l) => petalRuns(cx, baseY, 10, 11, l))),
    mid: runs([-12, -8, -4, 0, 4, 8, 12].flatMap((l) => petalRuns(cx, baseY, 12, 10, l))),
    light: runs([-8, -4, 0, 4, 8].flatMap((l) => petalRuns(cx, baseY, 14, 9, l))),
    pale: runs([-5, 0, 5].flatMap((l) => petalRuns(cx, baseY, 15, 8, l))),
  }
}

/** [cx, baseY, palette] — two focal blooms, each sitting on its own pad. */
const LOTUSES: [number, number, Lotus][] = [
  [44, 179, PINK],
  [300, 175, WHITE],
]

/* -------------------------------------------------------------------------
   The scene
   ------------------------------------------------------------------------- */

export default function PixelScenery() {
  return (
    <g>
      {/* --- sky --- */}
      {SKY_BANDS.map(([y0, y1, fill]) => (
        <rect key={y0} x={0} y={y0} width={360} height={y1 - y0} fill={fill} />
      ))}
      {STARS.map(([x, y, bright]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={bright ? '#ffffff' : '#b9c8ee'}
          opacity={bright ? 0.95 : 0.6}
        />
      ))}

      {/* --- the sleeping moon, with nothing drawn across it --- */}
      <path d={MOON_HALO} fill="#cfdcf8" opacity={0.4} />
      <path d={runs(discRuns(MOON_X, MOON_Y, MOON_R))} fill="#f8eec4" />
      <path d={runs(discRuns(MOON_X, MOON_Y, MOON_R).slice(0, 5))} fill="#fdf8e2" />
      <path d={MOON_BLUSH} fill="#f0a892" opacity={0.5} />
      <path d={MOON_EYES} fill="#a8853c" />
      <path d={MOON_SMILE} fill="#a8853c" />

      {/* --- treeline and the ground it stands on --- */}
      <path d={cols(TREE_RIDGE)} fill="#0b1c12" />
      {GRASS_BANDS.map(([y0, y1, fill]) => (
        <rect key={y0} x={0} y={y0} width={360} height={y1 - y0} fill={fill} />
      ))}

      {/* --- dark bamboo, behind everything that grows --- */}
      <path d={BACK_LEAVES} fill="#0b1d13" />
      <path d={BACK_BODY} fill="#0e2417" />
      <path d={BACK_NODES} fill="#081a10" />

      {/* --- vegetation, back to front --- */}
      <path d={VEG.back} fill="#0f2617" />
      <path d={VEG.backRim} fill="#1b3c25" />
      <path d={VEG.reeds} fill="#16331f" />
      <path d={VEG.mid} fill="#143520" />
      <path d={VEG.midRim} fill="#245030" />
      <path d={VEG.front} fill="#1a3f27" />
      <path d={VEG.frontRim} fill="#2f6340" />

      {/* --- the two lit canes, in front of the greenery --- */}
      <path d={FRONT_LEAVES} fill="#2c6039" />
      <path d={FRONT_BODY} fill="#245336" />
      <path d={FRONT_LIT} fill="#3c7a4a" />
      <path d={FRONT_DARK} fill="#132f1e" />
      <path d={FRONT_NODES} fill="#102718" />

      {/* --- flower clusters, scattered through all of it --- */}
      {VEG.flowers.map((f, i) => (
        <rect key={i} x={f.x} y={f.y} width={1} height={1} fill={f.c} opacity={0.85} />
      ))}

      {/* --- water --- */}
      {WATER_BANDS.map(([y0, y1, fill]) => (
        <rect key={y0} x={0} y={y0} width={360} height={y1 - y0} fill={fill} />
      ))}
      <rect x={0} y={WATER_TOP} width={360} height={5} fill="#16304e" opacity={0.7} />
      <path d={MOONPATH} fill="#c8d6ee" opacity={0.09} />
      <path d={RIPPLES.soft} fill="#5a7ba3" opacity={0.14} />
      <path d={RIPPLES.bright} fill="#7e9cc0" opacity={0.2} />

      {/* --- the rock shoreline --- */}
      <path d={ROCK_SHADE} fill="#151821" />
      <path d={ROCK_BODY} fill="#3a4050" />
      <path d={ROCK_LIT} fill="#5d6678" />

      {/* --- vegetation growing over the stones, so they sit in the bank --- */}
      <path d={VEG.shore} fill="#184027" />
      <path d={VEG.shoreRim} fill="#2d6540" />
      <path d={VEG.shoreReeds} fill="#22522f" />

      {/* --- lily pads: body, lit far half, shaded near half, veins, rim --- */}
      <path d={PAD_LAYERS.body} fill="#256b41" />
      <path d={PAD_LAYERS.light} fill="#2f8250" />
      <path d={PAD_LAYERS.shadow} fill="#17472b" />
      <path d={PAD_LAYERS.veins} fill="#3f9159" opacity={0.45} />
      <path d={PAD_LAYERS.rim} fill="#46a566" />
      <path d={PAD_LAYERS.spec} fill="#8fd9a5" opacity={0.75} />

      {/* --- the two lotuses, sitting on their pads --- */}
      {LOTUSES.map(([cx, baseY, c]) => {
        const l = lotusLayers(cx, baseY)
        return (
          <g key={cx}>
            <path d={l.shadow} fill={c.shadow} />
            <path d={l.dark} fill={c.dark} />
            <path d={l.mid} fill={c.mid} />
            <path d={l.light} fill={c.light} />
            <path d={l.pale} fill={c.pale} />
            <path d={runs([[cx - 1, baseY - 10, 3], [cx, baseY - 11, 1]])} fill={c.heart} />
          </g>
        )
      })}
    </g>
  )
}
