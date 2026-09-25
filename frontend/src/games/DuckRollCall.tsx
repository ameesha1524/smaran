import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSmaran } from '../state/SmaranContext'
import { STAGE_W, useStageScale } from '../scenes/PixelPond'
import type { LanguageCode, SessionResultDraft } from '../lib/types'
import { cue } from '../lib/ambient'
import './games.css'

/**
 * Duck Roll Call — visuospatial working memory (Domain 6: Executive Function
 * & Working Memory).
 *
 * All the ducklings flash a number at once — a parallel read, not one at a
 * time — then the numbers vanish and she taps them back in order, purely
 * from memory. Deliberately not audio-based: no name is spoken and no sound
 * marks the numbers, so the reading measures memory span rather than
 * language fluency or hearing. That was an explicit design decision, kept
 * here rather than just in a commit message because it is easy to "improve"
 * by accident.
 *
 * A round never has a hard failure. A wrong tap gets a gentle shake and
 * simply doesn't count — she keeps trying the same position until she has
 * it, and every round ends in every duckling finding its place. `wasCorrect`
 * only distinguishes a flawless round from one that took retries; it is
 * never a grade shown to her.
 *
 * Span (3→6, capped at the six ducklings the pond already has) and flash
 * duration (2000ms→800ms) are the two difficulty levers, and they move one
 * at a time: two clean rounds in a row raises span first and only tightens
 * timing once span 6 is reached, so difficulty never compounds two ways at
 * once. Both persist on-device across visits, the way a person's own memory
 * span is one number tracked over time rather than reset every sitting.
 */

/* ------------------------------------------------------------- geometry */
/*
 * These positions and every path below are carried over pixel-for-pixel from
 * the reference build already screenshotted and approved — same duckling
 * sprite as the pond's own family (identical paths to scenes/PixelPond.tsx's
 * Duckling/Duck), same tile/halo/hint glyphs. They are reproduced here rather
 * than imported because the pond's versions are nested inside one shared
 * 360×203 SVG for its own layering reasons; these are independent small SVGs
 * positioned by absolute CSS in the outer 1440×810 stage, matching how the
 * reference was built and proven to look right.
 */

interface SlotLayout {
  tile: { left: number; top: number }
  button: { left: number; top: number }
  bobDelay: number
}

const SLOTS: SlotLayout[] = [
  { tile: { left: 165, top: 380 }, button: { left: 130, top: 470 }, bobDelay: -0.0 },
  { tile: { left: 465, top: 320 }, button: { left: 430, top: 410 }, bobDelay: -0.37 },
  { tile: { left: 785, top: 380 }, button: { left: 750, top: 470 }, bobDelay: -0.74 },
  { tile: { left: 285, top: 540 }, button: { left: 250, top: 630 }, bobDelay: -1.11 },
  { tile: { left: 605, top: 520 }, button: { left: 570, top: 610 }, bobDelay: -1.48 },
  { tile: { left: 925, top: 540 }, button: { left: 890, top: 630 }, bobDelay: -1.85 },
]

/** The order slots unfurl as span grows past 3 — hand-tuned for a good spread. */
const PREVIEW_ORDER = [0, 2, 4, 1, 3, 5]

const JUGNUS: { left: number; top: number; driftDelay: number; blinkDelay: number }[] = [
  { left: 120, top: 180, driftDelay: -0.0, blinkDelay: -0.0 },
  { left: 300, top: 260, driftDelay: -1.3, blinkDelay: -0.9 },
  { left: 640, top: 220, driftDelay: -2.1, blinkDelay: -1.5 },
  { left: 980, top: 270, driftDelay: -0.6, blinkDelay: -0.4 },
  { left: 1280, top: 240, driftDelay: -1.8, blinkDelay: -1.3 },
  { left: 60, top: 400, driftDelay: -2.7, blinkDelay: -1.9 },
  { left: 1380, top: 440, driftDelay: -1.1, blinkDelay: -0.8 },
  { left: 520, top: 760, driftDelay: -0.4, blinkDelay: -0.3 },
]

/* --------------------------------------------------------------- sprites */

/** The exact duckling paths the pond already swims — drawn standalone here. */
function DucklingSprite() {
  return (
    <svg width="100" height="80" viewBox="0 0 10 8" shapeRendering="crispEdges" aria-hidden="true">
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
    </svg>
  )
}

function DucklingRipple() {
  return (
    <svg width="100" height="20" viewBox="0 0 10 2" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#8fb0ea" d="M2 0h6v1h-6zM0 1h1v1h-1zM9 1h1v1h-1z" />
    </svg>
  )
}

function MotherRipple() {
  return (
    <svg width="140" height="10" viewBox="0 0 14 1" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#8fb0ea" d="M0 0h4v1h-4zM6 0h6v1h-6z" />
    </svg>
  )
}

/** The idle mother duck, decorative, top-right of the water. */
function MotherDuckSprite() {
  return (
    <svg width="200" height="130" viewBox="0 0 20 13" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#2f7c6e" d="M14 0h3v1h-3zM13 1h5v1h-5zM13 2h2v1h-2zM16 2h1v1h-1z" />
      <path fill="#111118" d="M15 2h1v1h-1z" />
      <path fill="#e3b53e" d="M17 2h3v1h-3zM17 3h2v1h-2z" />
      <path fill="#8a6848" d="M13 3h4v1h-4zM14 4h3v1h-3z" />
      <path fill="#f3efe6" d="M14 5h3v1h-3z" />
      <path fill="#2c2a30" d="M2 6h2v1h-2zM1 7h2v1h-2z" />
      <path fill="#8a4a2c" d="M13 6h4v1h-4zM13 7h5v1h-5zM13 8h5v1h-5zM14 9h4v1h-4zM14 10h3v1h-3zM15 11h1v1h-1z" />
      <path fill="#3b2a1d" d="M3 7h1v1h-1zM2 8h1v1h-1zM2 9h1v1h-1zM2 10h1v1h-1zM3 11h1v1h-1zM5 12h11v1h-11z" />
      <path fill="#8d7458" d="M4 7h9v1h-9zM3 8h2v1h-2zM11 8h2v1h-2zM3 9h1v1h-1zM12 9h2v1h-2z" />
      <path fill="#6e5238" d="M5 8h6v1h-6zM4 9h4v1h-4zM10 9h2v1h-2z" />
      <path fill="#3a62d4" d="M8 9h2v1h-2z" />
      <path fill="#b8a58a" d="M3 10h11v1h-11zM4 11h11v1h-11z" />
    </svg>
  )
}

/** Border and interior of the number flag — identical for every digit. */
const TILE_BORDER =
  'M1 0h7v1h-7zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM1 8h3v1h-3zM5 8h3v1h-3zM3 9h1v1h-1zM5 9h1v1h-1zM4 10h1v1h-1z'
const TILE_INTERIOR =
  'M1 1h7v1h-7zM1 2h7v1h-7zM1 3h7v1h-7zM1 4h7v1h-7zM1 5h7v1h-7zM1 6h7v1h-7zM1 7h7v1h-7zM4 8h1v1h-1zM4 9h1v1h-1z'

/** The six digit glyphs, 1 through 6 — the ceiling matches the six ducklings. */
const DIGIT_GLYPH: Record<number, string> = {
  1: 'M4 2h1v1h-1zM3 3h2v1h-2zM4 4h1v1h-1zM4 5h1v1h-1zM3 6h3v1h-3z',
  2: 'M3 2h2v1h-2zM5 3h1v1h-1zM4 4h1v1h-1zM3 5h1v1h-1zM3 6h3v1h-3z',
  3: 'M3 2h2v1h-2zM5 3h1v1h-1zM4 4h1v1h-1zM5 5h1v1h-1zM3 6h2v1h-2z',
  4: 'M3 2h1v1h-1zM5 2h1v1h-1zM3 3h1v1h-1zM5 3h1v1h-1zM3 4h3v1h-3zM5 5h1v1h-1zM5 6h1v1h-1z',
  5: 'M3 2h3v1h-3zM3 3h1v1h-1zM3 4h2v1h-2zM5 5h1v1h-1zM3 6h2v1h-2z',
  6: 'M4 2h2v1h-2zM3 3h1v1h-1zM3 4h3v1h-3zM3 5h1v1h-1zM5 5h1v1h-1zM3 6h3v1h-3z',
}

function NumberTile({ digit }: { digit: number }) {
  return (
    <svg width="90" height="110" viewBox="0 0 9 11" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#2b2440" d={TILE_BORDER} />
      <path fill="#fff6dc" d={TILE_INTERIOR} />
      <path fill="#2b2440" d={DIGIT_GLYPH[digit]} />
    </svg>
  )
}

function Halo() {
  return (
    <svg width="160" height="130" viewBox="0 0 16 13" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#ffd95a"
        d="M5 0h6v1h-6zM3 1h10v1h-10zM2 2h3v1h-3zM11 2h3v1h-3zM1 3h2v1h-2zM13 3h2v1h-2zM0 4h2v1h-2zM14 4h2v1h-2zM0 5h2v1h-2zM14 5h2v1h-2zM0 6h2v1h-2zM14 6h2v1h-2zM0 7h2v1h-2zM14 7h2v1h-2zM0 8h2v1h-2zM14 8h2v1h-2zM1 9h2v1h-2zM13 9h2v1h-2zM2 10h3v1h-3zM11 10h3v1h-3zM3 11h10v1h-10zM5 12h6v1h-6z"
      />
      <path
        fill="#fff6c8"
        d="M6 1h4v1h-4zM4 2h3v1h-3zM9 2h3v1h-3zM2 3h2v1h-2zM12 3h2v1h-2zM2 4h1v1h-1zM13 4h1v1h-1zM1 5h2v1h-2zM13 5h2v1h-2zM1 6h2v1h-2zM13 6h2v1h-2zM1 7h2v1h-2zM13 7h2v1h-2zM2 8h1v1h-1zM13 8h1v1h-1zM2 9h2v1h-2zM12 9h2v1h-2zM4 10h3v1h-3zM9 10h3v1h-3zM6 11h4v1h-4z"
      />
    </svg>
  )
}

function HintArrow() {
  return (
    <svg width="160" height="50" viewBox="0 0 16 5" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#d6e6ff"
        d="M6 0h4v1h-4zM1 1h3v1h-3zM12 1h3v1h-3zM0 2h2v1h-2zM14 2h2v1h-2zM1 3h3v1h-3zM12 3h3v1h-3zM6 4h4v1h-4z"
      />
    </svg>
  )
}

function Egg({ on }: { on: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 4 4" shapeRendering="crispEdges" aria-hidden="true">
      <path fill={on ? '#e8c24a' : '#8fa3d6'} d="M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1zM0 2h1v1h-1zM3 2h1v1h-1zM1 3h2v1h-2z" />
      {on && <path fill="#fff3b0" d="M1 1h2v1h-2zM1 2h2v1h-2z" />}
    </svg>
  )
}

function Firefly({ blinking }: { blinking: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 3 3" shapeRendering="crispEdges" aria-hidden="true" style={{ opacity: blinking ? 1 : 0.25 }}>
      <path fill="#c7e85a" d="M1 0h1v1h-1zM0 1h1v1h-1zM2 1h1v1h-1zM1 2h1v1h-1z" />
      <path fill="#fffde0" d="M1 1h1v1h-1z" />
    </svg>
  )
}

/* --------------------------------------------------------------- copy */

const SCRIPT_FONT: Record<string, string> = {
  as: "'Noto Sans Bengali'",
  mni: "'Noto Sans Bengali'",
  hi: "'Noto Sans Devanagari'",
}

const TITLE: Record<string, string> = {
  en: 'DUCK ROLL CALL',
  as: 'হাঁহপোৱালিৰ হাজিৰা',
  mni: 'হাক-মচা কোইনবা',
  lus: 'BEL LO FANNA',
  hi: 'बत्तख हाज़िरी',
  nag: 'HASH-POWALI ROLL CALL',
}
const READY_FIRST: Record<string, string> = {
  en: 'Numbers will appear on the ducklings.\nRemember them, then tap them in order.',
  as: 'হাঁহপোৱালিবোৰৰ ওপৰত সংখ্যা ওলাব।\nমনত ৰাখক, তাৰপিছত ক্ৰমে স্পৰ্শ কৰক।',
  mni: 'হাক-মচাশিংদা নম্বর উৎলগনি।\nনিংশিংবিয়ু, অদুগী মতুংদা মথং মথং তাংবিয়ু।',
  lus: 'Bêl lote chuan number an lantîr ang.\nHre reng ang la, a dinhmun ang zêlin nghawih rawh.',
  hi: 'बत्तख़ के बच्चों पर संख्याएँ दिखेंगी।\nयाद रखिए, फिर क्रम से छूइए।',
  nag: 'Hash-powali khan te number ulabo.\nMonte rakhi bi, tarpichete crome tap koribi.',
}
const READY_AGAIN: Record<string, string> = {
  en: 'Ready for the next roll call?',
  as: 'পাছৰ হাজিৰাৰ বাবে সাজু নে?',
  mni: 'মথং কোইনবাদগী থৌরাং লৈরবা?',
  lus: 'A dawt lo fanna tûr i inpuahchah e?',
  hi: 'अगली हाज़िरी के लिए तैयार हैं?',
  nag: 'Pichete roll call laga taiyar ase?',
}
const FLASH_PROMPT: Record<string, string> = {
  en: 'Look at the numbers…',
  as: 'সংখ্যাবোৰলৈ চাওক…',
  mni: 'নম্বরশিং য়েংবিয়ু…',
  lus: 'Number te en teh…',
  hi: 'संख्याओं को देखिए…',
  nag: 'Number khan sabi…',
}
const TAKE_TIME: Record<string, string> = {
  en: 'Take your time.',
  as: 'সময় লওক।',
  mni: 'অতোপ্পা লৌবিয়ু।',
  lus: 'I hun takin ti rawh.',
  hi: 'अपना समय लीजिए।',
  nag: 'Apuni laga somoi lobi.',
}
const DONE_GOOD: Record<string, string> = {
  en: 'Every duckling is in line. Lovely!',
  as: 'সকলো হাঁহপোৱালি শাৰীত আছে। বাঃ!',
  mni: 'হাক-মচা পুম্নমক লাইনদা লৈরে। ফৎতাবা!',
  lus: 'Bêl lo apiang zawng an inzir tak zel. A ṭha ê!',
  hi: 'हर बत्तख का बच्चा कतार में है। वाह!',
  nag: 'Sob hash-powali line te ase. Bhal!',
}
const DONE_OK: Record<string, string> = {
  en: 'All the ducklings found their place.',
  as: 'সকলো হাঁহপোৱালিয়ে নিজৰ ঠাই পালে।',
  mni: 'হাক-মচা পুম্নমক্না মখোয়গী মফম ফংলে।',
  lus: 'Bêl lo apiang chuan an hmun an hmu ta vek.',
  hi: 'सभी बत्तख के बच्चों को अपनी जगह मिल गई।',
  nag: 'Sob hash-powali khan nijor jaga paise.',
}
const READY_BTN: Record<string, string> = {
  en: "I'm ready",
  as: 'মই সাজু',
  mni: 'ঐ থৌরাং লৈরে',
  lus: 'Ka inpuahchah',
  hi: 'मैं तैयार हूँ',
  nag: 'Moi taiyar ase',
}
const AGAIN_BTN: Record<string, string> = {
  en: 'Another round',
  as: 'আৰু এবাৰ',
  mni: 'অমুক্তা হানба',
  lus: 'Vawi khat leh',
  hi: 'एक बार और',
  nag: 'Aru ekbar',
}
const BACK_LABEL: Record<string, string> = {
  en: 'Back to games',
  as: 'খেলবোৰলৈ ঘূৰি যাওক',
  mni: 'শান্নবগী মফমদা হন্না চৎলু',
  lus: 'Games lam kir leh rawh',
  hi: 'खेलों की ओर वापस',
  nag: 'Khel khan te wapas jabi',
}

function recallPrompt(language: LanguageCode, next: number): string {
  const templates: Record<string, (n: number) => string> = {
    en: (n) => `Tap the duckling that had number ${n}`,
    as: (n) => `${n} সংখ্যা থকা হাঁহপোৱালিটো স্পৰ্শ কৰক`,
    mni: (n) => `নম্বর ${n} লৈরিবা হাক-মচা অদু তাংবিয়ু`,
    lus: (n) => `Number ${n} nei bêl lo chu nghawih rawh`,
    hi: (n) => `जिस बत्तख के बच्चे पर संख्या ${n} थी, उसे छुइए`,
    nag: (n) => `Number ${n} thaka hash-powali te tap koribi`,
  }
  const fn = templates[language] ?? templates.en
  return fn(next)
}

/* ----------------------------------------------------------------- data */

interface DuckRoundResult {
  spanLength: number
  flashDurationMs: number
  wasCorrect: boolean
  attemptsBeforeCorrect: number
  sessionTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
  at: number
}

const SPAN_KEY = 'smaran.duckRollCall.span'
const FLASH_KEY = 'smaran.duckRollCall.flashMs'
const HISTORY_KEY = 'smaran.duckRollCall.history'
const KEEP_HISTORY = 60
const DEFAULT_SPAN = 3
const DEFAULT_FLASH = 2000

function readHistory(): DuckRoundResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as DuckRoundResult[]) : []
  } catch {
    return []
  }
}

function writeHistory(list: DuckRoundResult[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-KEEP_HISTORY)))
  } catch {
    // A full or blocked store must not take the round down with it.
  }
}

function timeOfDay(): DuckRoundResult['sessionTimeOfDay'] {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'
}

/**
 * The single longitudinal number this game exists to produce: the span at
 * which accuracy first drops below 70%, read over a rolling window of recent
 * rounds — the same shape as clinical digit-span capacity tracking.
 */
function breakdownSpan(history: DuckRoundResult[]): number | null {
  const recent = history.slice(-12)
  for (let span = 3; span <= 6; span++) {
    const atSpan = recent.filter((h) => h.spanLength === span)
    if (atSpan.length >= 3 && atSpan.filter((h) => h.wasCorrect).length / atSpan.length < 0.7) return span
  }
  return null
}

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ---------------------------------------------------------------- round */

type Phase = 'ready' | 'flash' | 'recall' | 'done'

interface RoundState {
  phase: Phase
  span: number
  flashMs: number
  used: number[]
  nums: Record<number, number>
  next: number
  wrong: number
  wrongHere: number
  done: number[]
  shaking: number
  firstRound: boolean
  last: DuckRoundResult | null
}

export default function DuckRollCall() {
  const { language, profile, moodToday, stillness, tapTarget, completeSession } = useSmaran()
  const navigate = useNavigate()
  const scale = useStageScale()

  // Heightened sensitivity, read from the same behavioural signal every other
  // game eases on — never a manual toggle, never something she is asked.
  const errorless = profile.anxietyThreshold <= 0.5

  const historyRef = useRef<DuckRoundResult[]>(readHistory())
  const sittingStartedAt = useRef(Date.now())
  const sittingRoundsRef = useRef<DuckRoundResult[]>([])
  const wrongTapsRef = useRef(0)
  const correctTapsRef = useRef(0)
  const finishedRef = useRef(false)
  const shakeTimer = useRef<number | null>(null)
  const flashTimer = useRef<number | null>(null)

  const [state, setState] = useState<RoundState>(() => ({
    phase: 'ready',
    span: Number(localStorage.getItem(SPAN_KEY)) || DEFAULT_SPAN,
    flashMs: Number(localStorage.getItem(FLASH_KEY)) || DEFAULT_FLASH,
    used: [],
    nums: {},
    next: 1,
    wrong: 0,
    wrongHere: 0,
    done: [],
    shaking: -1,
    firstRound: true,
    last: null,
  }))

  const patch = useCallback((p: Partial<RoundState>) => setState((s) => ({ ...s, ...p })), [])

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      if (shakeTimer.current) window.clearTimeout(shakeTimer.current)
    },
    [],
  )

  /* ------------------------------------------------------- one sitting */

  const finishSitting = useCallback(() => {
    if (finishedRef.current || sittingRoundsRef.current.length === 0) return
    finishedRef.current = true

    const rounds = sittingRoundsRef.current
    const completionRate =
      rounds.reduce((sum, r) => sum + (r.wasCorrect ? 1 : Math.max(0.3, 1 - r.attemptsBeforeCorrect * 0.15)), 0) /
      rounds.length
    const finalSpan = rounds[rounds.length - 1].spanLength
    const difficultyTier = finalSpan <= 3 ? 1 : finalSpan <= 4 ? 2 : 3
    const totalTaps = wrongTapsRef.current + correctTapsRef.current
    const cognitiveLoadScore = totalTaps > 0 ? Math.min(1, wrongTapsRef.current / totalTaps) : 0

    const draft: SessionResultDraft = {
      gameType: 'DUCK_ROLL_CALL',
      startedAt: sittingStartedAt.current,
      durationMs: Date.now() - sittingStartedAt.current,
      completionRate: Number(completionRate.toFixed(3)),
      difficultyTier,
      cognitiveLoadScore: Number(cognitiveLoadScore.toFixed(3)),
      moodAtStart: moodToday ?? 'QUIET',
    }
    void completeSession(draft)
  }, [completeSession, moodToday])

  useEffect(() => finishSitting, [finishSitting])

  const leave = () => {
    finishSitting()
    navigate('/games')
  }

  /* ---------------------------------------------------------- one round */

  const start = () => {
    const span = state.span
    const usedSlots = shuffle([0, 1, 2, 3, 4, 5])
      .slice(0, span)
      .sort((a, b) => a - b)
    const order = shuffle(usedSlots.map((_, i) => i + 1))
    const nums: Record<number, number> = {}
    usedSlots.forEach((slot, i) => {
      nums[slot] = order[i]
    })

    patch({
      phase: 'flash',
      used: usedSlots,
      nums,
      next: 1,
      wrong: 0,
      wrongHere: 0,
      done: [],
      shaking: -1,
      firstRound: false,
    })

    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => patch({ phase: 'recall' }), state.flashMs)
  }

  const finishRound = (doneSlots: number[]) => {
    const result: DuckRoundResult = {
      spanLength: state.span,
      flashDurationMs: state.flashMs,
      wasCorrect: state.wrong === 0,
      attemptsBeforeCorrect: state.wrong,
      sessionTimeOfDay: timeOfDay(),
      at: Date.now(),
    }
    const history = [...historyRef.current, result]
    historyRef.current = history
    writeHistory(history)
    sittingRoundsRef.current = [...sittingRoundsRef.current, result]

    // Two clean rounds at the current settings move exactly one lever; two
    // rough ones ease exactly one lever back. Never both at once.
    let span = state.span
    let flashMs = state.flashMs
    const lastTwo = history.slice(-2)
    const sameSettings = (h: DuckRoundResult) => h.spanLength === state.span && h.flashDurationMs === state.flashMs
    if (lastTwo.length === 2 && lastTwo.every((h) => sameSettings(h) && h.wasCorrect)) {
      if (span < 6) span += 1
      else if (flashMs > 800) flashMs = Math.max(800, flashMs - 400)
    } else if (lastTwo.length === 2 && lastTwo.every((h) => sameSettings(h) && !h.wasCorrect)) {
      if (flashMs < 2000) flashMs = Math.min(2000, flashMs + 400)
      else if (span > 3) span -= 1
    }
    localStorage.setItem(SPAN_KEY, String(span))
    localStorage.setItem(FLASH_KEY, String(flashMs))

    cue(result.wasCorrect ? 'bloom' : 'petal')
    patch({ phase: 'done', done: doneSlots, last: result, span, flashMs })
  }

  const tap = (slot: number) => {
    if (state.phase !== 'recall' || state.done.includes(slot)) return
    if (state.nums[slot] === state.next) {
      correctTapsRef.current++
      const done = [...state.done, slot]
      if (state.next === state.span) {
        finishRound(done)
        return
      }
      patch({ done, next: state.next + 1, wrongHere: 0 })
    } else {
      wrongTapsRef.current++
      patch({ wrong: state.wrong + 1, wrongHere: state.wrongHere + 1, shaking: slot })
      if (shakeTimer.current) window.clearTimeout(shakeTimer.current)
      shakeTimer.current = window.setTimeout(() => patch({ shaking: -1 }), 520)
    }
  }

  const restart = () => {
    if (state.phase === 'done') patch({ phase: 'ready', used: [], nums: {}, done: [] })
    else start()
  }

  /* --------------------------------------------------------------- copy */

  const inRound = state.phase === 'flash' || state.phase === 'recall' || state.phase === 'done'
  const prompt = useMemo(() => {
    if (state.phase === 'ready' || state.phase === 'done') {
      if (state.phase === 'done' && state.last) return state.last.wasCorrect ? DONE_GOOD[language] ?? DONE_GOOD.en : DONE_OK[language] ?? DONE_OK.en
      return state.firstRound ? READY_FIRST[language] ?? READY_FIRST.en : READY_AGAIN[language] ?? READY_AGAIN.en
    }
    if (state.phase === 'flash') return FLASH_PROMPT[language] ?? FLASH_PROMPT.en
    return recallPrompt(language, state.next)
  }, [state.phase, state.firstRound, state.last, state.next, language])

  const L = state.last
  const devMetrics =
    'SESSION (not shown to patient)\n' +
    `span now: ${state.span}   flash: ${state.flashMs}ms\n` +
    `errorless: ${errorless ? 'on' : 'off'}\n` +
    `rounds: ${sittingRoundsRef.current.length}\n` +
    (L
      ? `last: span ${L.spanLength}, ${L.flashDurationMs}ms\n  correct: ${L.wasCorrect}, wrong taps: ${L.attemptsBeforeCorrect}\n  ${L.sessionTimeOfDay}\n`
      : '') +
    `breakdownSpan: ${breakdownSpan(historyRef.current) ?? 'not reached'}`

  const showEggs = state.phase !== 'ready'
  const eggCount = inRound ? state.span : state.span
  const foundCount = state.phase === 'done' ? eggCount : state.next - 1

  return (
    <div className={`px-viewport ${stillness ? 'still' : ''}`}>
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <div style={{ position: 'relative', width: STAGE_W, height: 810, overflow: 'hidden', background: '#0a1330' }}>
          {/* The reference pond, pixel for pixel — 144x81 art on the 10px grid — with
              only its own two lotuses taken out. Sky, moon, bamboo, grass, shoreline
              and water are exactly the reference's. */}
          <img
            src="/duck-pond.png"
            alt=""
            width={STAGE_W}
            height={810}
            style={{ position: 'absolute', left: 0, top: 0, width: STAGE_W, height: 810, imageRendering: 'pixelated', display: 'block' }}
          />
          {/* The lilies are the pond's own art, not the reference's: cropped by the
              corners in front, medium ones framing the edges, small ones far off. */}
          <img
            src="/duck-lilies.png"
            alt=""
            width={STAGE_W}
            height={810}
            style={{ position: 'absolute', left: 0, top: 0, width: STAGE_W, height: 810, imageRendering: 'pixelated', display: 'block', pointerEvents: 'none' }}
          />

          {JUGNUS.map((j, i) => (
            <span
              key={i}
              className={`drc-fly drc-fly-${i % 2}`}
              style={{ position: 'absolute', left: j.left, top: j.top, animationDelay: `${j.driftDelay}s` }}
            >
              <span className="drc-blink" style={{ display: 'block', animationDelay: `${j.blinkDelay}s` }}>
                <Firefly blinking />
              </span>
            </span>
          ))}

          {/* ---------------------------------------------------- mother duck */}
          <span className="drc-bob" style={{ position: 'absolute', left: 1150, top: 360, animationDelay: '0s' }}>
            <span style={{ display: 'block', transform: 'scaleX(-1)' }}>
              <MotherDuckSprite />
            </span>
          </span>
          <span style={{ position: 'absolute', left: 1180, top: 490 }}>
            <MotherRipple />
          </span>

          {/* -------------------------------------------------------- title */}
          <div
            style={{
              position: 'absolute',
              left: 290,
              top: 22,
              width: 860,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 10,
            }}
          >
            {/* Letter-spacing wrecks Indic conjuncts, so only Latin scripts get it. */}
            <div
              style={{
                fontFamily: SCRIPT_FONT[language] ? `${SCRIPT_FONT[language]}, sans-serif` : "'VT323', monospace",
                fontSize: SCRIPT_FONT[language] ? 24 : 28,
                letterSpacing: SCRIPT_FONT[language] ? '0.08em' : '0.3em',
                color: '#aeb7cc',
              }}
            >
              {TITLE[language] ?? TITLE.en}
            </div>
            <div
              style={{
                fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
                fontSize: 42,
                lineHeight: 1.2,
                color: '#f5f0e6',
                textShadow: '5px 5px 0 #070d26',
                whiteSpace: 'pre-line',
              }}
            >
              {prompt}
            </div>
            {state.phase === 'recall' && state.wrongHere > 0 && (
              <div style={{ fontFamily: "'VT323', monospace", fontSize: 30, color: '#cfd8ee', textShadow: '3px 3px 0 #070d26' }}>
                {TAKE_TIME[language] ?? TAKE_TIME.en}
              </div>
            )}
            {showEggs && (
              <div style={{ display: 'flex', gap: 20, marginTop: 4 }} aria-label={`${foundCount} of ${eggCount} found`}>
                {Array.from({ length: eggCount }, (_, i) => (
                  <Egg key={i} on={i < foundCount} />
                ))}
              </div>
            )}
          </div>

          {/* --------------------------------------------------- start / again */}
          {(state.phase === 'ready' || state.phase === 'done') && (
            <div style={{ position: 'absolute', left: 0, top: 250, width: STAGE_W, display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={restart}
                className="drc-btn"
                style={{ height: Math.max(80, tapTarget) }}
              >
                {state.phase === 'done' ? AGAIN_BTN[language] ?? AGAIN_BTN.en : READY_BTN[language] ?? READY_BTN.en}
              </button>
            </div>
          )}

          {/* ---------------------------------------------------------- ducklings */}
          {SLOTS.map((slot, i) => {
            const visible = inRound ? state.used.includes(i) : PREVIEW_ORDER.slice(0, state.span).includes(i)
            if (!visible) return null
            const digit = state.nums[i]
            const showNumber = state.phase === 'flash' || state.done.includes(i)
            const isDone = state.done.includes(i)
            const isHint = errorless && state.phase === 'recall' && state.wrongHere >= 1 && digit === state.next
            const isShaking = state.shaking === i

            return (
              <div key={i}>
                {showNumber && digit != null && (
                  <div style={{ position: 'absolute', left: slot.tile.left, top: slot.tile.top, pointerEvents: 'none' }}>
                    <NumberTile digit={digit} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => tap(i)}
                  aria-label="Duckling"
                  className={`drc-duck ${isShaking ? 'drc-shake' : ''}`}
                  style={{
                    position: 'absolute',
                    left: slot.button.left,
                    top: slot.button.top,
                    width: Math.max(160, tapTarget * 1.8),
                    height: Math.max(140, tapTarget * 1.6),
                    padding: 0,
                    border: 0,
                    background: 'none',
                    cursor: state.phase === 'recall' ? 'pointer' : 'default',
                  }}
                >
                  {isHint && (
                    <span className="drc-hint" style={{ position: 'absolute', left: 0, top: 90 }}>
                      <HintArrow />
                    </span>
                  )}
                  {isDone && (
                    <span className="drc-halo" style={{ position: 'absolute', left: 0, top: -5 }}>
                      <Halo />
                    </span>
                  )}
                  <span className="drc-bob" style={{ position: 'absolute', left: 30, top: 30, animationDelay: `${slot.bobDelay}s` }}>
                    <DucklingSprite />
                  </span>
                  <span style={{ position: 'absolute', left: 30, top: 110 }}>
                    <DucklingRipple />
                  </span>
                </button>
              </div>
            )
          })}

          {/* -------------------------------------------------------- back link */}
          <button
            type="button"
            onClick={leave}
            className="drc-back"
            style={{ minHeight: Math.max(44, tapTarget * 0.6) }}
          >
            {BACK_LABEL[language] ?? BACK_LABEL.en}
          </button>

          {import.meta.env.DEV && (
            <div
              style={{
                position: 'absolute',
                left: 20,
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
