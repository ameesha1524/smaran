/**
 * LanguageFlower.tsx — the six blooms a language is chosen by.
 *
 * Each language gets its own colour rather than its own label. A patient who
 * can no longer read her own script can still recognise "mine is the purple
 * one", so the colour is the real identifier here and the text underneath is
 * only a confirmation. That is also why every bloom is the same shape: only
 * the hue should be doing the work of telling them apart.
 *
 * A closed bud means "not chosen"; the chosen one opens. Drawn in source
 * pixels and scaled up whole, so the art stays on the grid.
 */

export type FlowerTone = 'white' | 'pink' | 'coral' | 'purple' | 'gold' | 'blue'

interface Palette {
  base: string
  l1: string
  l2: string
  l3: string
  l4: string
  eye: string
}

const TONES: Record<FlowerTone, Palette> = {
  white: { base: '#8e9bbb', l1: '#f2f5fb', l2: '#ffffff', l3: '#e4e9f4', l4: '#d3dbeb', eye: '#fff3cf' },
  pink: { base: '#b8507f', l1: '#e6749f', l2: '#f8b8d0', l3: '#ee9dbd', l4: '#d8699a', eye: '#fff0f5' },
  coral: { base: '#c2563a', l1: '#e8845c', l2: '#ffc2a0', l3: '#f5a880', l4: '#dd7550', eye: '#fff0e4' },
  purple: { base: '#6f4aa8', l1: '#9a74d0', l2: '#cdb2f0', l3: '#b797e4', l4: '#8a66c4', eye: '#f4ecff' },
  gold: { base: '#b8892a', l1: '#e0b447', l2: '#ffe08a', l3: '#f5cd6a', l4: '#d8a83c', eye: '#fffbe6' },
  blue: { base: '#2f5f9e', l1: '#5a8cc8', l2: '#a6cdf0', l3: '#84b4e2', l4: '#4f7fb8', eye: '#eaf4ff' },
}

/** Which bloom belongs to which language. Fixed for life — it is her landmark. */
export const FLOWER_TONE: Record<string, FlowerTone> = {
  en: 'white',
  as: 'pink',
  mni: 'coral',
  lus: 'purple',
  hi: 'gold',
  nag: 'blue',
}

/** The open bloom: what the chosen language looks like. */
export function FlowerBloom({ tone, scale = 4 }: { tone: FlowerTone; scale?: number }) {
  const c = TONES[tone]
  return (
    <svg
      width={21 * scale}
      height={11 * scale}
      viewBox="0 0 21 11"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path
        fill={c.base}
        d="M7 0h2v1h-2zM13 0h1v1h-1zM7 1h3v1h-3zM12 1h2v1h-2zM3 2h2v1h-2zM6 2h2v1h-2zM9 2h9v1h-9zM3 3h1v1h-1zM5 3h4v1h-4zM10 3h5v1h-5zM16 3h2v1h-2zM3 4h2v1h-2zM6 4h12v1h-12zM3 5h5v1h-5zM9 5h2v1h-2zM12 5h6v1h-6zM0 6h10v1h-10zM12 6h9v1h-9zM2 7h3v1h-3zM6 7h9v1h-9zM16 7h3v1h-3zM4 8h2v1h-2zM8 8h5v1h-5zM15 8h2v1h-2zM3 9h6v1h-6zM12 9h6v1h-6zM8 10h4v1h-4z"
      />
      <path fill={c.l1} d="M8 2h1v1h-1zM4 3h1v1h-1zM9 3h1v1h-1z" />
      <path
        fill={c.l2}
        d="M15 3h1v1h-1zM5 4h1v1h-1zM5 7h1v1h-1zM15 7h1v1h-1zM6 8h2v1h-2zM13 8h2v1h-2zM9 9h1v1h-1zM11 9h1v1h-1z"
      />
      <path fill={c.l3} d="M8 5h1v1h-1zM10 6h2v1h-2z" />
      <path fill={c.l4} d="M11 5h1v1h-1z" />
      <path fill={c.eye} d="M10 9h1v1h-1z" />
    </svg>
  )
}

/** The closed bud: every language that is not the current one. */
export function FlowerBud({ tone, scale = 4 }: { tone: FlowerTone; scale?: number }) {
  const c = TONES[tone]
  return (
    <svg
      width={5 * scale}
      height={9 * scale}
      viewBox="0 0 5 9"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path
        fill={c.l2}
        d="M2 0h1v1h-1zM1 1h1v1h-1zM3 1h1v1h-1zM1 2h1v1h-1zM3 2h1v1h-1zM0 3h2v1h-2zM3 3h2v1h-2zM1 4h1v1h-1zM3 4h1v1h-1zM1 5h1v1h-1zM3 5h1v1h-1z"
      />
      <path fill={c.base} d="M2 1h1v1h-1zM2 2h1v1h-1zM2 3h1v1h-1zM2 4h1v1h-1zM2 5h1v1h-1z" />
      <path fill="#3f7a3c" d="M0 5h1v1h-1zM4 5h1v1h-1zM1 6h3v1h-3zM2 7h1v1h-1zM2 8h1v1h-1z" />
    </svg>
  )
}
