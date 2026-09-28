import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSmaran } from '../state/SmaranContext'
import { STAGE_W, useStageScale } from '../scenes/PixelPond'
import type { LanguageCode, SessionResultDraft } from '../lib/types'
import { cue } from '../lib/ambient'
import './games.css'

/**
 * The Koi Are Jumping — sustained visual attention & response initiation
 * (Domain 3: Motor). Until this game, nothing actually closed the loop on
 * that domain after onboarding's own first estimate; Morning Rituals used to
 * stand in for it for lack of a better fit and now reads temporal alone —
 * the same split Duck Roll Call did for executiveFunction.
 *
 * The pond sits still. Every so often the water ripples, and a few seconds
 * later something leaps — a koi half the time, otherwise a little silver
 * fish, a frog or a turtle — from either bank, at a different size and
 * speed each time, and is back in the water within about two seconds.
 * The whole arc is one enormous, forgiving tap target: she is
 * reading the leap, not aiming at a point on the screen, and a slow or
 * missed tap is never marked as wrong. There is no visible timer, no score,
 * and — deliberately, as with every other game here — no penalty sound.
 *
 * A sitting is a fixed number of leaps bookended by two quiet screens: a
 * "watch the water" instruction with a stone to tap to begin, and a closing
 * "the pond is quiet now" once the leaps are done. She can leave from the
 * back link at any point in between; leaving early still banks whatever
 * leaps she saw.
 */

/* --------------------------------------------------------------- sprites */

/** The exact creature paths from the reference build, reproduced standalone. */
function KoiSprite() {
  return (
    <svg width="144" height="56" viewBox="0 0 36 14" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#c9d6ef"
        d="M0 0h1v1h-1zM16 0h3v1h-3zM0 1h2v1h-2zM15 1h6v1h-6zM1 2h2v1h-2zM2 3h2v1h-2zM2 4h3v1h-3zM3 5h2v1h-2zM3 6h3v1h-3zM3 7h3v1h-3zM3 8h2v1h-2zM26 8h3v1h-3zM2 9h3v1h-3zM26 9h2v1h-2zM2 10h2v1h-2zM1 11h2v1h-2zM13 11h3v1h-3zM0 12h2v1h-2zM14 12h3v1h-3zM0 13h1v1h-1z"
      />
      <path
        fill="#9fb3d8"
        d="M1 0h1v1h-1zM15 0h1v1h-1zM19 0h2v1h-2zM2 1h1v1h-1zM14 1h1v1h-1zM21 1h1v1h-1zM0 2h1v1h-1zM3 2h1v1h-1zM1 3h1v1h-1zM4 3h1v1h-1zM2 5h1v1h-1zM5 5h1v1h-1zM6 6h1v1h-1zM6 7h1v1h-1zM2 8h1v1h-1zM5 8h1v1h-1zM28 9h1v1h-1zM1 10h1v1h-1zM4 10h1v1h-1zM12 10h1v1h-1zM27 10h1v1h-1zM0 11h1v1h-1zM3 11h1v1h-1zM2 12h1v1h-1zM13 12h1v1h-1zM17 12h1v1h-1zM1 13h1v1h-1zM14 13h3v1h-3z"
      />
      <path
        fill="#ec7a2a"
        d="M14 2h6v1h-6zM12 3h9v1h-9zM27 3h3v1h-3zM12 4h9v1h-9zM27 4h5v1h-5zM12 5h8v1h-8zM27 5h3v1h-3zM14 6h1v1h-1zM16 6h2v1h-2zM27 6h4v1h-4zM10 7h3v1h-3zM21 7h4v1h-4zM10 8h4v1h-4zM20 8h5v1h-5zM20 9h5v1h-5zM21 10h1v1h-1z"
      />
      <path fill="#fffaf0" d="M20 2h4v1h-4zM24 3h1v1h-1zM30 5h1v1h-1z" />
      <path
        fill="#f3efe6"
        d="M11 3h1v1h-1zM21 3h3v1h-3zM25 3h2v1h-2zM9 4h3v1h-3zM21 4h6v1h-6zM32 4h2v1h-2zM7 5h5v1h-5zM20 5h7v1h-7zM33 5h2v1h-2zM7 6h7v1h-7zM15 6h1v1h-1zM18 6h9v1h-9zM33 6h2v1h-2zM9 7h1v1h-1zM13 7h8v1h-8zM25 7h9v1h-9zM14 8h6v1h-6zM25 8h1v1h-1zM29 8h3v1h-3zM13 9h7v1h-7zM25 9h1v1h-1zM16 10h5v1h-5z"
      />
      <path fill="#1c1a24" d="M31 5h2v1h-2zM31 6h2v1h-2zM34 7h2v1h-2z" />
      <path
        fill="#c25f1c"
        d="M35 5h1v1h-1zM35 6h1v1h-1zM7 7h2v1h-2zM9 8h1v1h-1zM32 8h4v1h-4zM10 9h3v1h-3zM29 9h3v1h-3zM13 10h3v1h-3zM22 10h4v1h-4zM16 11h6v1h-6z"
      />
    </svg>
  )
}

function SilverfishSprite() {
  return (
    <svg width="144" height="56" viewBox="0 0 36 14" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#e4eaf5"
        d="M0 0h1v1h-1zM16 0h3v1h-3zM0 1h2v1h-2zM15 1h6v1h-6zM1 2h2v1h-2zM2 3h2v1h-2zM2 4h3v1h-3zM3 5h2v1h-2zM3 6h3v1h-3zM3 7h3v1h-3zM3 8h2v1h-2zM26 8h3v1h-3zM2 9h3v1h-3zM26 9h2v1h-2zM2 10h2v1h-2zM1 11h2v1h-2zM13 11h3v1h-3zM0 12h2v1h-2zM14 12h3v1h-3zM0 13h1v1h-1z"
      />
      <path
        fill="#9aa7c0"
        d="M1 0h1v1h-1zM15 0h1v1h-1zM19 0h2v1h-2zM2 1h1v1h-1zM14 1h1v1h-1zM21 1h1v1h-1zM0 2h1v1h-1zM3 2h1v1h-1zM1 3h1v1h-1zM4 3h1v1h-1zM2 5h1v1h-1zM5 5h1v1h-1zM6 6h1v1h-1zM6 7h1v1h-1zM2 8h1v1h-1zM5 8h1v1h-1zM28 9h1v1h-1zM1 10h1v1h-1zM4 10h1v1h-1zM12 10h1v1h-1zM27 10h1v1h-1zM0 11h1v1h-1zM3 11h1v1h-1zM2 12h1v1h-1zM13 12h1v1h-1zM17 12h1v1h-1zM1 13h1v1h-1zM14 13h3v1h-3z"
      />
      <path
        fill="#c3ccdd"
        d="M14 2h2v1h-2zM11 3h13v1h-13zM25 3h5v1h-5zM9 4h25v1h-25zM7 5h23v1h-23zM33 5h2v1h-2zM7 6h24v1h-24zM33 6h2v1h-2zM9 7h25v1h-25zM10 8h16v1h-16zM29 8h3v1h-3zM13 9h13v1h-13zM16 10h6v1h-6z"
      />
      <path fill="#eef2fa" d="M16 2h8v1h-8zM24 3h1v1h-1zM30 5h1v1h-1z" />
      <path fill="#1c1a24" d="M31 5h2v1h-2zM31 6h2v1h-2zM34 7h2v1h-2z" />
      <path
        fill="#8d9ab4"
        d="M35 5h1v1h-1zM35 6h1v1h-1zM7 7h2v1h-2zM9 8h1v1h-1zM32 8h4v1h-4zM10 9h3v1h-3zM29 9h3v1h-3zM13 10h3v1h-3zM22 10h4v1h-4zM16 11h6v1h-6z"
      />
    </svg>
  )
}

function FrogSprite() {
  return (
    <svg width="104" height="72" viewBox="0 0 26 18" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#3f6e36"
        d="M6 1h5v1h-5zM15 1h5v1h-5zM6 2h1v1h-1zM10 2h6v1h-6zM19 2h1v1h-1zM6 3h1v1h-1zM10 3h6v1h-6zM19 3h1v1h-1zM6 4h1v1h-1zM10 4h1v1h-1zM15 4h1v1h-1zM19 4h1v1h-1zM5 5h5v1h-5zM16 5h5v1h-5zM5 6h1v1h-1zM20 6h1v1h-1zM5 7h1v1h-1zM20 7h1v1h-1zM5 8h2v1h-2zM19 8h2v1h-2zM3 9h3v1h-3zM7 9h2v1h-2zM17 9h2v1h-2zM20 9h3v1h-3zM1 10h1v1h-1zM4 10h2v1h-2zM10 10h6v1h-6zM20 10h2v1h-2zM24 10h1v1h-1zM0 11h2v1h-2zM4 11h1v1h-1zM21 11h1v1h-1zM24 11h2v1h-2zM0 12h2v1h-2zM4 12h2v1h-2zM20 12h2v1h-2zM24 12h2v1h-2zM0 13h2v1h-2zM5 13h1v1h-1zM20 13h1v1h-1zM24 13h2v1h-2zM1 14h7v1h-7zM18 14h7v1h-7zM0 15h1v1h-1zM3 15h3v1h-3zM8 15h3v1h-3zM15 15h3v1h-3zM20 15h3v1h-3zM25 15h1v1h-1zM1 16h3v1h-3zM22 16h3v1h-3zM1 17h1v1h-1zM3 17h1v1h-1zM22 17h1v1h-1zM24 17h1v1h-1z"
      />
      <path fill="#f3efe6" d="M7 2h3v1h-3zM16 2h3v1h-3zM7 3h1v1h-1zM16 3h1v1h-1zM7 4h1v1h-1zM9 4h1v1h-1zM16 4h1v1h-1zM18 4h1v1h-1z" />
      <path fill="#1c1a24" d="M8 3h2v1h-2zM17 3h2v1h-2zM8 4h1v1h-1zM17 4h1v1h-1z" />
      <path
        fill="#6c9c52"
        d="M11 4h4v1h-4zM10 5h6v1h-6zM6 6h14v1h-14zM6 7h14v1h-14zM7 8h2v1h-2zM10 8h7v1h-7zM18 8h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM19 9h1v1h-1zM2 10h2v1h-2zM6 10h3v1h-3zM17 10h3v1h-3zM22 10h2v1h-2zM2 11h2v1h-2zM5 11h3v1h-3zM18 11h3v1h-3zM22 11h2v1h-2zM2 12h2v1h-2zM6 12h2v1h-2zM18 12h2v1h-2zM22 12h2v1h-2zM2 13h3v1h-3zM6 13h2v1h-2zM18 13h2v1h-2zM21 13h3v1h-3zM8 14h1v1h-1zM17 14h1v1h-1zM11 15h4v1h-4z"
      />
      <path fill="#23452a" d="M9 8h1v1h-1zM17 8h1v1h-1zM10 9h7v1h-7zM8 16h11v1h-11z" />
      <path fill="#8bbb63" d="M9 10h1v1h-1zM16 10h1v1h-1zM8 11h10v1h-10zM8 12h10v1h-10zM8 13h10v1h-10zM9 14h8v1h-8z" />
    </svg>
  )
}

function TurtleSprite() {
  return (
    <svg width="104" height="64" viewBox="0 0 26 16" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#4a3c20"
        d="M9 4h8v1h-8zM7 5h3v1h-3zM16 5h3v1h-3zM5 6h2v1h-2zM19 6h2v1h-2zM4 7h2v1h-2zM20 7h2v1h-2zM3 8h2v1h-2zM21 8h2v1h-2zM3 9h1v1h-1zM22 9h1v1h-1zM3 10h1v1h-1zM22 10h1v1h-1zM2 11h2v1h-2zM22 11h2v1h-2z"
      />
      <path
        fill="#7d6a3c"
        d="M10 5h6v1h-6zM7 6h5v1h-5zM14 6h5v1h-5zM6 7h6v1h-6zM14 7h6v1h-6zM5 8h2v1h-2zM10 8h6v1h-6zM19 8h2v1h-2zM4 9h4v1h-4zM10 9h2v1h-2zM14 9h2v1h-2zM18 9h4v1h-4zM4 10h1v1h-1zM6 10h6v1h-6zM14 10h6v1h-6zM21 10h1v1h-1zM7 11h1v1h-1zM11 11h4v1h-4zM18 11h1v1h-1z"
      />
      <path
        fill="#2f5526"
        d="M20 5h1v1h-1zM23 5h2v1h-2zM25 6h1v1h-1zM25 7h1v1h-1zM24 8h2v1h-2zM23 9h2v1h-2zM1 10h1v1h-1zM1 12h1v1h-1zM23 12h1v1h-1zM2 13h4v1h-4zM20 13h3v1h-3z"
      />
      <path
        fill="#6c9c52"
        d="M21 5h2v1h-2zM21 6h2v1h-2zM24 6h1v1h-1zM22 7h1v1h-1zM23 8h1v1h-1zM2 10h1v1h-1zM1 11h1v1h-1zM2 12h2v1h-2zM22 12h1v1h-1z"
      />
      <path
        fill="#f6df72"
        d="M12 6h2v1h-2zM12 7h2v1h-2zM7 8h3v1h-3zM16 8h3v1h-3zM8 9h2v1h-2zM12 9h2v1h-2zM16 9h2v1h-2zM5 10h1v1h-1zM12 10h2v1h-2zM20 10h1v1h-1zM4 11h3v1h-3zM8 11h3v1h-3zM15 11h3v1h-3zM19 11h3v1h-3z"
      />
      <path fill="#1c1a24" d="M23 6h1v1h-1zM23 7h2v1h-2z" />
      <path fill="#a58c4e" d="M4 12h18v1h-18zM6 13h14v1h-14zM10 14h6v1h-6z" />
    </svg>
  )
}

const CREATURE_SPRITE: Record<Creature, () => JSX.Element> = {
  koi: KoiSprite,
  silverfish: SilverfishSprite,
  frog: FrogSprite,
  turtle: TurtleSprite,
}

/** Each sprite is drawn at a different native size, so each carries its own centring offset. */
const CREATURE_BOX: Record<Creature, { w: number; h: number; mt: number; ml: number }> = {
  koi: { w: 144, h: 56, mt: -28, ml: -72 },
  silverfish: { w: 144, h: 56, mt: -28, ml: -72 },
  frog: { w: 104, h: 72, mt: -36, ml: -52 },
  turtle: { w: 104, h: 64, mt: -32, ml: -52 },
}

function Ripple() {
  return (
    <svg width="64" height="20" viewBox="0 0 16 5" shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block' }}>
      <path fill="#8fb6ef" d="M2 0h12v1h-12zM1 1h1v1h-1zM14 1h1v1h-1zM0 2h1v1h-1zM15 2h1v1h-1zM1 3h1v1h-1zM14 3h1v1h-1zM2 4h12v1h-12z" />
      <path fill="#5d86c8" d="M3 2h10v1h-10z" />
    </svg>
  )
}

function Splash() {
  return (
    <svg width="64" height="24" viewBox="0 0 16 6" shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block' }}>
      <path
        fill="#cfe0f7"
        d="M2 0h1v1h-1zM7 0h1v1h-1zM12 0h1v1h-1zM1 1h1v1h-1zM4 1h1v1h-1zM6 1h1v1h-1zM8 1h1v1h-1zM11 1h1v1h-1zM14 1h1v1h-1zM0 2h1v1h-1zM3 2h2v1h-2zM7 2h1v1h-1zM10 2h2v1h-2zM15 2h1v1h-1zM2 3h3v1h-3zM9 3h3v1h-3zM1 4h1v1h-1zM12 4h1v1h-1zM2 5h10v1h-10z"
      />
      <path fill="#f2f7ff" d="M5 3h4v1h-4zM2 4h10v1h-10z" />
    </svg>
  )
}

/** A small lotus — the only thing a leap ever leaves behind. */
function LotusBloom() {
  return (
    <svg width="44" height="28" viewBox="0 0 11 7" shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block' }}>
      <path
        fill="#f0a6c8"
        d="M3 0h1v1h-1zM5 0h1v1h-1zM7 0h1v1h-1zM2 1h7v1h-7zM1 2h2v1h-2zM8 2h2v1h-2zM0 3h3v1h-3zM8 3h3v1h-3zM1 4h3v1h-3zM7 4h3v1h-3zM2 5h6v1h-6z"
      />
      <path fill="#fbe6a2" d="M3 2h1v1h-1zM7 2h1v1h-1zM3 3h1v1h-1zM7 3h1v1h-1z" />
      <path fill="#f6df72" d="M4 2h3v1h-3zM4 3h3v1h-3zM4 4h3v1h-3z" />
      <path fill="#3f6e36" d="M3 6h4v1h-4z" />
    </svg>
  )
}

function Firefly() {
  return (
    <svg width="12" height="12" viewBox="0 0 3 3" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#c7e85a" d="M1 0h1v1h-1zM0 1h1v1h-1zM2 1h1v1h-1zM1 2h1v1h-1z" />
      <path fill="#fffde0" d="M1 1h1v1h-1z" />
    </svg>
  )
}

/** The stone the sitting begins on: the same art in every language. */
function StoneSprite() {
  return (
    <svg width="120" height="120" viewBox="0 0 30 30" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#c9a640"
        d="M10 1h10v1h-10zM8 2h2v1h-2zM20 2h2v1h-2zM6 3h2v1h-2zM22 3h2v1h-2zM5 4h2v1h-2zM23 4h2v1h-2zM4 5h1v1h-1zM25 5h1v1h-1zM3 6h2v1h-2zM25 6h2v1h-2zM3 7h1v1h-1zM26 7h1v1h-1zM2 8h1v1h-1zM27 8h1v1h-1zM2 9h1v1h-1zM27 9h1v1h-1zM1 10h1v1h-1zM28 10h1v1h-1zM1 11h1v1h-1zM28 11h1v1h-1zM1 12h1v1h-1zM28 12h1v1h-1zM1 13h1v1h-1zM28 13h1v1h-1zM1 14h1v1h-1zM28 14h1v1h-1zM1 15h1v1h-1zM28 15h1v1h-1zM1 16h1v1h-1zM28 16h1v1h-1zM1 17h1v1h-1zM28 17h1v1h-1zM1 18h1v1h-1zM28 18h1v1h-1zM1 19h1v1h-1zM28 19h1v1h-1zM2 20h1v1h-1zM27 20h1v1h-1zM2 21h1v1h-1zM27 21h1v1h-1zM3 22h1v1h-1zM26 22h1v1h-1zM3 23h2v1h-2zM25 23h2v1h-2zM4 24h1v1h-1zM25 24h1v1h-1zM5 25h2v1h-2zM23 25h2v1h-2zM6 26h2v1h-2zM22 26h2v1h-2zM8 27h2v1h-2zM20 27h2v1h-2zM10 28h10v1h-10z"
      />
      <path
        fill="#34457e"
        d="M10 2h10v1h-10zM8 3h3v1h-3zM19 3h3v1h-3zM7 4h2v1h-2zM21 4h2v1h-2zM5 5h2v1h-2zM23 5h2v1h-2zM5 6h1v1h-1zM4 7h1v1h-1zM3 8h2v1h-2zM3 9h1v1h-1zM2 10h2v1h-2zM2 11h1v1h-1zM2 12h1v1h-1zM2 13h1v1h-1zM2 14h1v1h-1zM2 15h1v1h-1zM2 16h1v1h-1zM2 17h1v1h-1zM2 18h1v1h-1zM2 19h2v1h-2zM3 20h1v1h-1zM3 21h2v1h-2zM4 22h1v1h-1zM5 23h1v1h-1zM5 24h1v1h-1z"
      />
      <path
        fill="#16204a"
        d="M11 3h8v1h-8zM9 4h12v1h-12zM7 5h16v1h-16zM6 6h3v1h-3zM13 6h12v1h-12zM5 7h3v1h-3zM14 7h12v1h-12zM5 8h2v1h-2zM15 8h12v1h-12zM4 9h3v1h-3zM15 9h12v1h-12zM4 10h3v1h-3zM15 10h13v1h-13zM3 11h5v1h-5zM14 11h14v1h-14zM3 12h6v1h-6zM13 12h15v1h-15zM3 13h25v1h-25zM3 14h25v1h-25zM3 15h25v1h-25zM3 16h25v1h-25zM3 17h25v1h-25zM3 18h25v1h-25zM4 19h24v1h-24zM4 20h23v1h-23zM5 21h22v1h-22zM5 22h21v1h-21zM6 23h19v1h-19zM6 24h19v1h-19zM7 25h16v1h-16zM8 26h14v1h-14zM10 27h10v1h-10z"
      />
      <path fill="#26346a" d="M9 6h4v1h-4zM8 7h6v1h-6zM7 8h8v1h-8zM7 9h8v1h-8zM7 10h8v1h-8zM8 11h6v1h-6zM9 12h4v1h-4z" />
    </svg>
  )
}

function StoneGlyph() {
  return (
    <svg width="28" height="32" viewBox="0 0 7 8" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#e6c55a"
        d="M3 0h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM1 3h2v1h-2zM4 3h2v1h-2zM1 4h1v1h-1zM3 4h1v1h-1zM5 4h1v1h-1zM2 5h1v1h-1zM4 5h1v1h-1zM3 6h1v1h-1zM3 7h1v1h-1z"
      />
      <path fill="#1a254f" d="M3 1h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM3 5h1v1h-1z" />
    </svg>
  )
}

/* --------------------------------------------------------------- copy */

const SCRIPT_FONT: Record<string, string> = {
  as: "'Noto Sans Bengali'",
  mni: "'Noto Sans Bengali'",
  hi: "'Noto Sans Devanagari'",
}

const GAME_TITLE: Record<string, string> = {
  en: 'THE KOI ARE JUMPING',
  as: 'কৈ জপিয়াই আছে',
  mni: 'কৈশিং থোকখৎলি',
  lus: 'SÁNG-NGÁ AN LÊNG MEK',
  hi: 'कोई उछल रही हैं',
  nag: 'KOI MAS KHAN JUPISE',
}
const HEADLINE: Record<string, string> = {
  en: 'The koi are jumping tonight',
  as: 'আজি ৰাতি কৈ মাছবোৰে জপিয়াই আছে',
  mni: 'ঙসি ঙারোন কৈশিং থোকখৎলি',
  lus: 'Tûnzân hian sáng-ngá te an lêng mek',
  hi: 'आज रात कोई मछलियाँ उछल रही हैं',
  nag: 'Aji rati koi mas khan uporte jupise',
}
const SUBTEXT: Record<string, string> = {
  en: 'Watch the water. Tap the koi when they leap.',
  as: 'পানীলৈ চাই থাকক। কৈবোৰে জপিয়ালে স্পৰ্শ কৰক।',
  mni: 'ইশিং য়েংবিয়ু। কৈ থোকখৎলবদা তাংবিয়ু।',
  lus: 'Tui chu enfiah reng ang. Sáng-ngá an lêng hunah nghawih rawh.',
  hi: 'पानी को देखते रहिए। जब कोई उछले तब उसे छुइए।',
  nag: 'Pani te sabi thakibi. Koi mas jup korile tap koribi.',
}
const TAP_STONE: Record<string, string> = {
  en: 'tap the stone to begin',
  as: 'আৰম্ভ কৰিবলৈ শিলটোত স্পৰ্শ কৰক',
  mni: 'হৌনবা নুংশিত তাংবিয়ু',
  lus: 'Tan atân lung chu nghawih rawh',
  hi: 'शुरू करने के लिए पत्थर को छुइए',
  nag: 'Shuru koribole pathor te tap koribi',
}
const BEGIN_BTN: Record<string, string> = {
  en: 'BEGIN',
  as: 'আৰম্ভ',
  mni: 'হৌবিয়ু',
  lus: 'TAN ROH',
  hi: 'शुरू करें',
  nag: 'SHURU',
}
const OUTRO_HEADLINE: Record<string, string> = {
  en: 'The pond is quiet now.',
  as: 'এতিয়া পুখুৰীখন শান্ত।',
  mni: 'হৌজিক পুকহী অসি ঐমান লৈরে।',
  lus: 'Tuikhur chu a ngai ta a.',
  hi: 'अब तालाब शांत है।',
  nag: 'Etia pukhuri khan shanto ase.',
}
const OUTRO_SUBTEXT: Record<string, string> = {
  en: 'Lotuses opened in the garden while you sat with the koi.',
  as: 'আপুনি কৈৰ সৈতে বহি থাকোঁতে বাৰীত পদুমফুল ফুলিল।',
  mni: 'নঙে কৈগা লৈখোংদা লৈফূগী মপান হংল্লে।',
  lus: 'Sáng-ngá chunga i tuah lai chuan huan-ah lian pâr a inhawng.',
  hi: 'जब आप कोई के साथ बैठे थे, तब बगीचे में कमल खिले।',
  nag: 'Apuni koi laga logote bohi thaka homoi te bagan te podum ful phuli jaise.',
}
const BACK_LABEL: Record<string, string> = {
  en: 'Back to games',
  as: 'খেলবোৰলৈ ঘূৰি যাওক',
  mni: 'শান্নবগী মফমদা হন্না চৎলু',
  lus: 'Games lam kir leh rawh',
  hi: 'खेलों की ओर वापस',
  nag: 'Khel khan te wapas jabi',
}

const SAY: Record<string, Record<Creature, string>> = {
  en: { koi: 'a koi!', silverfish: 'a little silver fish', frog: 'a frog, saying hello', turtle: 'a turtle, in no hurry' },
  as: { koi: 'এটা কৈ মাছ!', silverfish: 'এটা সৰু ৰূপৰ মাছ', frog: 'এটা ভেকুলী, সেৱা জনাইছে', turtle: 'এটা কমা, খৰধৰ নাই' },
  mni: { koi: 'কৈ অমা!', silverfish: 'অপীকপা অঙাংবা ঙা অমা', frog: 'খৰোং অমা, খুরুমজরি', turtle: 'কোরোউ অমা, য়াম্না নত্তে চৎলি' },
  lus: { koi: 'sáng-ngá pakhat!', silverfish: 'ngá dawn tê pakhat', frog: 'u pakhat, chibai a bûk', turtle: 'kawlhpui pakhat, a grâp lo' },
  hi: { koi: 'एक कोई मछली!', silverfish: 'एक छोटी चाँदी जैसी मछली', frog: 'एक मेंढक, नमस्ते कहता हुआ', turtle: 'एक कछुआ, बिना जल्दी के' },
  nag: { koi: 'ekta koi mas!', silverfish: 'ekta huru rupa mas', frog: 'ekta bengmata, salam di ase', turtle: 'ekta kaisa, joldi nai' },
}

function sayFor(language: LanguageCode, creature: Creature): string {
  const table = SAY[language] ?? SAY.en
  return table[creature]
}

/* ----------------------------------------------------------------- data */

type Creature = 'koi' | 'silverfish' | 'frog' | 'turtle'
type RoundPhase = 'resting' | 'anticipation' | 'jumping' | 'landing'
type SessionPhase = 'intro' | 'playing' | 'outro'

interface KoiRoundResult {
  creature: Creature
  wasTapped: boolean
  reactionMs: number | null
  direction: 'ltr' | 'rtl'
  radiusPx: number
  leapMs: number
  sessionTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
}

/** A sitting is six leaps — long enough to be a real reading, short enough
 * to stay a rest rather than a task. */
const ROUND_LIMIT = 6

function timeOfDay(): KoiRoundResult['sessionTimeOfDay'] {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'
}

/**
 * Half koi, half visitors. The reference ran 74% koi, which made "it's a koi"
 * a safe guess every time; at even odds she has to actually look. A streak of
 * three of the same creature is broken, so the mix never settles into a pattern.
 */
function pickCreature(recent: Creature[]): Creature {
  const roll = (): Creature => {
    if (Math.random() < 0.5) return 'koi'
    const others: Creature[] = ['silverfish', 'frog', 'turtle']
    return others[Math.floor(Math.random() * others.length)]
  }
  let c = roll()
  const [a, b] = recent.slice(-2)
  while (a === c && b === c) c = roll()
  return c
}

/** Where and how one leap goes. Every field is re-rolled per leap. */
interface LeapShape {
  x: number
  /** Arc radius — half the leap's width, and its height. */
  r: number
  /** 1 = left to right, -1 = right to left. */
  dir: 1 | -1
  durMs: number
}

/**
 * Shorter and quicker than the reference's single 216px / 2.9s arc, and never
 * the same twice: radius 110–170px, 1.5–2.2s in the air. Under reduced motion
 * she gets half as long again to see it.
 */
function rollLeap(reduced: boolean): LeapShape {
  const r = Math.round(110 + Math.random() * 60)
  const base = 1500 + Math.random() * 700
  return {
    // Keep the whole arc on the water, whichever size it rolled.
    x: 300 + r + Math.random() * (840 - 2 * r),
    r,
    dir: Math.random() < 0.5 ? 1 : -1,
    durMs: Math.round(reduced ? base * 1.5 : base),
  }
}

const JUGNUS = [
  { left: 90, top: 660, driftDelay: -0, blinkDelay: -0 },
  { left: 1330, top: 640, driftDelay: -1.4, blinkDelay: -1.0 },
  { left: 1240, top: 700, driftDelay: -2.2, blinkDelay: -1.5 },
  { left: 170, top: 700, driftDelay: -0.8, blinkDelay: -0.6 },
]

const OUTRO_BLOOMS = [
  { left: 430, top: 690, delay: 0.2, rotate: -4 },
  { left: 760, top: 748, delay: 0.9, rotate: 3 },
  { left: 1040, top: 682, delay: 1.5, rotate: -2 },
]

export default function KoiAreJumping() {
  const { language, moodToday, stillness, tapTarget, completeSession } = useSmaran()
  const navigate = useNavigate()
  const scale = useStageScale()

  const [session, setSession] = useState<SessionPhase>('intro')
  const [round, setRound] = useState<RoundPhase>('resting')
  const [leapShape, setLeapShape] = useState<LeapShape>({ x: 720, r: 150, dir: 1, durMs: 1800 })
  const [creature, setCreature] = useState<Creature>('koi')
  const [say, setSay] = useState<string | null>(null)
  const [bloom, setBloom] = useState(false)
  const [splashX, setSplashX] = useState(0)

  const timer = useRef<number | null>(null)
  const sayTimer = useRef<number | null>(null)
  const jumpStartedAt = useRef(0)
  const roundsRef = useRef<KoiRoundResult[]>([])
  const roundCountRef = useRef(0)
  const sittingStartedAt = useRef(Date.now())
  const finishedRef = useRef(false)

  // The loop below is a chain of setTimeouts spanning several seconds, and a
  // tap can land at any point inside that window. State set through useState
  // is only ever current as of the render that scheduled a given timeout, so
  // the three things a later step in the chain must read — where the jump
  // was, what it was, and whether she already caught it — are mirrored here
  // in refs, which are always current regardless of when the closure runs.
  const leapRef = useRef<LeapShape>({ x: 720, r: 150, dir: 1, durMs: 1800 })
  const creatureRef = useRef<Creature>('koi')
  const tappedRef = useRef(false)
  const reactionRef = useRef(0)

  const reduced =
    stillness || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
      if (sayTimer.current) window.clearTimeout(sayTimer.current)
    },
    [],
  )

  /* ------------------------------------------------------- one sitting */

  const finishSitting = useCallback(() => {
    if (finishedRef.current || roundsRef.current.length === 0) return
    finishedRef.current = true

    const rounds = roundsRef.current
    const tappedCount = rounds.filter((r) => r.wasTapped).length
    const completionRate = Number((tappedCount / rounds.length).toFixed(3))
    const cognitiveLoadScore = Number(((rounds.length - tappedCount) / rounds.length).toFixed(3))

    const draft: SessionResultDraft = {
      gameType: 'KOI_ARE_JUMPING',
      startedAt: sittingStartedAt.current,
      durationMs: Date.now() - sittingStartedAt.current,
      completionRate,
      // The reference has no difficulty lever of its own — the leap timing
      // never changes — so there is nothing honest to report but one tier.
      difficultyTier: 1,
      cognitiveLoadScore,
      moodAtStart: moodToday ?? 'QUIET',
    }
    void completeSession(draft)
  }, [completeSession, moodToday])

  useEffect(() => finishSitting, [finishSitting])

  const leave = () => {
    finishSitting()
    navigate('/games')
  }

  /* ---------------------------------------------------------- the loop */

  const beginAnticipation = () => {
    const shape = rollLeap(reduced)
    const c = pickCreature(roundsRef.current.map((r) => r.creature))
    leapRef.current = shape
    creatureRef.current = c
    tappedRef.current = false
    setLeapShape(shape)
    setCreature(c)
    setSay(null)
    setBloom(false)
    setRound('anticipation')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(leap, 1300)
  }

  const leap = () => {
    const { x, r, dir, durMs } = leapRef.current
    setSplashX(x - r * dir)
    jumpStartedAt.current = Date.now()
    setRound('jumping')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(splashDown, durMs)
  }

  const splashDown = () => {
    cue('pond-tap')
    const leapNow = leapRef.current
    setSplashX(leapNow.x + leapNow.r * leapNow.dir)
    setRound('landing')

    const wasTapped = tappedRef.current
    roundsRef.current = [
      ...roundsRef.current,
      {
        creature: creatureRef.current,
        wasTapped,
        reactionMs: wasTapped ? reactionRef.current : null,
        sessionTimeOfDay: timeOfDay(),
        direction: leapNow.dir === 1 ? 'ltr' : 'rtl',
        radiusPx: leapNow.r,
        leapMs: leapNow.durMs,
      },
    ]
    roundCountRef.current += 1

    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (roundCountRef.current >= ROUND_LIMIT) {
        finishSitting()
        setSession('outro')
        return
      }
      setRound('resting')
      setSay(null)
      setBloom(false)
      timer.current = window.setTimeout(beginAnticipation, 1800 + Math.random() * 1600)
    }, 1500)
  }

  const tap = () => {
    if (round !== 'jumping' || tappedRef.current) return
    tappedRef.current = true
    reactionRef.current = Date.now() - jumpStartedAt.current
    const isKoi = creatureRef.current === 'koi'
    setSay(sayFor(language, creatureRef.current))
    setBloom(isKoi)
    cue(isKoi ? 'bloom' : 'petal')
    if (sayTimer.current) window.clearTimeout(sayTimer.current)
    sayTimer.current = window.setTimeout(() => setSay(null), 2400)
  }

  const start = () => {
    setSession('playing')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(beginAnticipation, 1600)
  }

  /* --------------------------------------------------------------- copy */

  const { x: jumpX, r: leapR, dir: leapDir, durMs: leapMs } = leapShape
  const exitX = jumpX - leapR * leapDir
  const entryX = jumpX + leapR * leapDir
  // The tap band spans the whole arc plus a generous margin either side.
  const zoneW = 2 * leapR + 200
  const zoneLeft = Math.round(jumpX - zoneW / 2)
  const showRipple = round === 'anticipation'
  const showSplash = round === 'jumping' || round === 'landing'
  const showCreature = round === 'jumping'
  const box = CREATURE_BOX[creature]
  const CreatureSprite = CREATURE_SPRITE[creature]

  const devMetrics = useMemo(() => {
    const rounds = roundsRef.current
    const tapped_ = rounds.filter((r) => r.wasTapped).length
    return (
      'SESSION (not shown to patient)\n' +
      `round: ${roundCountRef.current} / ${ROUND_LIMIT}\n` +
      `phase: ${session} / ${round}\n` +
      `caught: ${tapped_} / ${rounds.length}`
    )
  }, [session, round])

  return (
    <div className={`px-viewport ${stillness ? 'still' : ''}`}>
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <div style={{ position: 'relative', width: STAGE_W, height: 810, overflow: 'hidden', background: '#0a1330' }}>
          {/* The same pond as the pixel Home screen, byte-for-byte — this
              reference reuses that exact background asset. */}
          <img
            src="/pond-pixel.png"
            alt=""
            width={STAGE_W}
            height={810}
            style={{ position: 'absolute', left: 0, top: 0, width: STAGE_W, height: 810, imageRendering: 'pixelated', display: 'block' }}
          />

          {JUGNUS.map((j, i) => (
            <span key={i} className="koi-fly" style={{ position: 'absolute', left: j.left, top: j.top, animationDelay: `${j.driftDelay}s` }}>
              <span className="koi-blink" style={{ display: 'block', animationDelay: `${j.blinkDelay}s` }}>
                <Firefly />
              </span>
            </span>
          ))}

          {/* -------------------------------------------------------- intro */}
          {session === 'intro' && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 150,
                  width: STAGE_W,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: SCRIPT_FONT[language] ? `${SCRIPT_FONT[language]}, sans-serif` : "'VT323', monospace",
                    fontSize: SCRIPT_FONT[language] ? 20 : 22,
                    letterSpacing: SCRIPT_FONT[language] ? '0.06em' : '0.3em',
                    color: '#aeb7cc',
                  }}
                >
                  {GAME_TITLE[language] ?? GAME_TITLE.en}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
                    fontWeight: 600,
                    fontSize: 44,
                    lineHeight: 1.15,
                    color: '#f5f0e6',
                    textShadow: '4px 4px 0 #070d26',
                  }}
                >
                  {HEADLINE[language] ?? HEADLINE.en}
                </div>
                <div style={{ marginTop: 6, fontFamily: "'VT323', monospace", fontSize: 25, color: '#d2d8e7', textShadow: '2px 2px 0 #070d26' }}>
                  {SUBTEXT[language] ?? SUBTEXT.en}
                </div>
              </div>

              <span className="koi-hop" style={{ position: 'absolute', left: 300, top: 618 }}>
                <span style={{ display: 'block', marginLeft: -72, marginTop: -28, transform: 'rotate(-34deg)' }}>
                  <KoiSprite />
                </span>
              </span>
              <span className="koi-hop" style={{ position: 'absolute', left: 1040, top: 652, animationDelay: '-1.4s' }}>
                <span style={{ display: 'block', marginLeft: -72, marginTop: -28, transform: 'rotate(30deg)' }}>
                  <KoiSprite />
                </span>
              </span>

              <span className="koi-ring" style={{ position: 'absolute', left: 648, top: 498, width: 144, height: 144, boxSizing: 'border-box', border: '4px dashed rgba(246,223,114,0.35)', borderRadius: '50%' }} />
              <button
                type="button"
                onClick={start}
                className="koi-stone"
                aria-label="Begin — tap to start"
                style={{ position: 'absolute', left: 661, top: 511, width: Math.max(118, tapTarget * 1.5), height: Math.max(118, tapTarget * 1.5) }}
              >
                <span style={{ position: 'absolute', left: 0, top: 0 }}>
                  <StoneSprite />
                </span>
                <span style={{ position: 'absolute', left: 0, top: 24, width: 118, textAlign: 'center', fontFamily: "'VT323', monospace", fontSize: 22, letterSpacing: '0.15em', color: '#dbe1ee' }}>
                  {BEGIN_BTN[language] ?? BEGIN_BTN.en}
                </span>
                <span style={{ position: 'absolute', left: 45, top: 54 }}>
                  <StoneGlyph />
                </span>
              </button>
              <div style={{ position: 'absolute', left: 0, top: 700, width: STAGE_W, textAlign: 'center', fontFamily: "'VT323', monospace", fontSize: 24, color: '#dbe4f5', textShadow: '2px 2px 0 #070d26' }}>
                {TAP_STONE[language] ?? TAP_STONE.en}
              </div>
            </>
          )}

          {/* -------------------------------------------------------- playing */}
          {session === 'playing' && (
            <>
              {showRipple && (
                <div style={{ position: 'absolute', left: exitX, top: 616, marginLeft: -32, marginTop: -10 }}>
                  <span className="koi-rip" style={{ display: 'block' }}>
                    <Ripple />
                  </span>
                </div>
              )}

              {showSplash && (
                <div style={{ position: 'absolute', left: splashX, top: 616, marginLeft: -32, marginTop: -12 }}>
                  <span className="koi-spl" style={{ display: 'block' }}>
                    <Splash />
                  </span>
                </div>
              )}

              {bloom && (
                <div style={{ position: 'absolute', left: entryX, top: 610, marginLeft: -22, marginTop: -14 }}>
                  <span className="koi-bloom-in" style={{ display: 'block' }}>
                    <LotusBloom />
                  </span>
                </div>
              )}

              {showCreature && (
                // A zero-size anchor at the leap's centre, so mirroring it flips
                // both the path and the sprite about that one point — a
                // right-to-left leap is the same leap, seen from the other bank.
                <div
                  style={{
                    position: 'absolute',
                    left: jumpX,
                    top: 644,
                    width: 0,
                    height: 0,
                    transform: leapDir === -1 ? 'scaleX(-1)' : undefined,
                  }}
                >
                  <span
                    className="koi-arc"
                    style={{ animationDuration: `${leapMs}ms`, ['--r' as string]: leapR } as CSSProperties}
                  >
                    <span style={{ display: 'block', marginLeft: box.ml, marginTop: box.mt }}>
                      <CreatureSprite />
                    </span>
                  </span>
                </div>
              )}

              {round === 'jumping' && (
                <button
                  type="button"
                  onClick={tap}
                  className="koi-zone"
                  style={{ left: zoneLeft, width: zoneW, top: 644 - leapR - 90, height: leapR + 160, minHeight: Math.max(240, tapTarget * 3) }}
                  aria-label="Tap when something leaps"
                />
              )}

              {say && (
                <div
                  className="koi-say"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 250,
                    width: STAGE_W,
                    textAlign: 'center',
                    fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
                    fontSize: 34,
                    color: '#f5f0e6',
                    textShadow: '4px 4px 0 #070d26',
                  }}
                >
                  {say}
                </div>
              )}
            </>
          )}

          {/* --------------------------------------------------------- outro */}
          {session === 'outro' && (
            <>
              {OUTRO_BLOOMS.map((b, i) => (
                <span
                  key={i}
                  className="koi-outro-bloom"
                  style={{ position: 'absolute', left: b.left, top: b.top, opacity: 0.92, animationDelay: `${b.delay}s` }}
                >
                  <span style={{ display: 'block', marginLeft: -72, marginTop: -28, transform: `rotate(${b.rotate}deg)` }}>
                    <KoiSprite />
                  </span>
                </span>
              ))}
              <div style={{ position: 'absolute', left: 0, top: 250, width: STAGE_W, textAlign: 'center' }}>
                <div
                  className="koi-line"
                  style={{
                    fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
                    fontWeight: 600,
                    fontSize: 40,
                    color: '#f5f0e6',
                    textShadow: '4px 4px 0 #070d26',
                  }}
                >
                  {OUTRO_HEADLINE[language] ?? OUTRO_HEADLINE.en}
                </div>
                <div
                  className="koi-line"
                  style={{
                    marginTop: 18,
                    fontFamily: "'VT323', monospace",
                    fontSize: 25,
                    color: '#d2d8e7',
                    textShadow: '2px 2px 0 #070d26',
                    animationDelay: '0.6s',
                  }}
                >
                  {OUTRO_SUBTEXT[language] ?? OUTRO_SUBTEXT.en}
                </div>
              </div>
            </>
          )}

          {/* -------------------------------------------------------- back link */}
          <button type="button" onClick={leave} className="koi-back" style={{ minHeight: Math.max(44, tapTarget * 0.6) }}>
            ← {BACK_LABEL[language] ?? BACK_LABEL.en}
          </button>

          {import.meta.env.DEV && (
            <div
              style={{
                position: 'absolute',
                right: 20,
                top: 20,
                width: 250,
                boxSizing: 'border-box',
                padding: '14px 16px',
                background: 'rgba(10,19,48,0.9)',
                boxShadow: '0 0 0 4px #3a4c8c',
                fontFamily: "'VT323', monospace",
                fontSize: 21,
                lineHeight: 1.15,
                color: '#cfd8ee',
                whiteSpace: 'pre-line',
              }}
            >
              {devMetrics}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
