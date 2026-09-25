import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import PixelPond, { useStageScale } from '../scenes/PixelPond'
import { useSmaran } from '../state/SmaranContext'
import { t } from '../i18n/strings'
import type { GameType } from '../lib/types'

/**
 * Every quiet thing in one place.
 *
 * Home used to carry two or three of these as cards of its own, chosen for
 * her by the day's routing. That routing still runs — it still sets the
 * difficulty, the tap size and the ambient tone once she picks something —
 * but the picking itself is hers. One door opens from the pond; everything
 * lives behind it, always in the same order, so where a thing lives is
 * never a surprise twice.
 */

interface Entry {
  key: GameType
  path: string
  label: string
  icon: () => JSX.Element
}

const ENTRIES: Entry[] = [
  { key: 'DUCK_ROLL_CALL', path: '/game/duck-roll-call', label: 'Duck Roll Call', icon: DuckIcon },
  { key: 'GRANDMOTHERS_TALE', path: '/game/grandmothers-tale', label: "Grandmother's Tale", icon: TreeIcon },
  { key: 'FAMILY_GROVE', path: '/game/family-grove', label: 'Family Grove', icon: TreeIcon },
  { key: 'MORNING_RITUALS', path: '/game/morning-rituals', label: 'Morning Rituals', icon: SunriseIcon },
  { key: 'LOTUS_FROG', path: '/game/lotus-frog', label: 'The Lotus Frog', icon: FrogIcon },
]

/* ------------------------------------------------------------------ sprites */

function DuckIcon() {
  return (
    <svg width="36" height="32" viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#f6df72"
        d="M3 0h3v1h-3zM2 1h4v1h-4zM1 2h6v1h-6zM0 3h8v1h-8zM0 4h8v1h-8zM1 5h6v1h-6z"
      />
      <path fill="#6f5130" d="M2 4h3v1h-3z" />
      <path fill="#111118" d="M6 1h1v1h-1z" />
      <path fill="#d99a3e" d="M7 2h2v1h-2zM2 6h1v1h-1zM5 6h1v1h-1z" />
    </svg>
  )
}

function FrogIcon() {
  return (
    <svg width="36" height="28" viewBox="0 0 9 7" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#5fb05a" d="M1 0h1v1h-1zM2 0h1v1h-1zM6 0h1v1h-1zM7 0h1v1h-1zM0 1h1v1h-1zM3 1h1v1h-1zM5 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM7 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM1 3h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM7 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM7 5h1v1h-1z" />
      <path fill="#2f7d3a" d="M1 4h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM0 6h1v1h-1zM1 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1z" />
      <path fill="#f4f1e0" d="M1 1h1v1h-1zM6 1h1v1h-1z" />
      <path fill="#1a1a1a" d="M2 1h1v1h-1zM7 1h1v1h-1z" />
    </svg>
  )
}

function TreeIcon() {
  return (
    <svg width="36" height="40" viewBox="0 0 9 10" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#2f7d3a"
        d="M3 0h3v1h-3zM2 1h1v1h-1zM6 1h1v1h-1zM1 2h1v1h-1zM4 2h1v1h-1zM7 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM7 5h1v1h-1zM2 6h2v1h-2zM5 6h2v1h-2z"
      />
      <path
        fill="#5fb05a"
        d="M3 1h3v1h-3zM2 2h2v1h-2zM5 2h2v1h-2zM1 3h5v1h-5zM7 3h1v1h-1zM1 4h1v1h-1zM3 4h5v1h-5zM2 5h3v1h-3zM6 5h1v1h-1z"
      />
      <path fill="#8a5a36" d="M4 6h1v1h-1zM4 7h1v1h-1zM4 8h1v1h-1zM3 9h3v1h-3z" />
    </svg>
  )
}

function SunriseIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#f06a5a"
        d="M0 0h9v1h-9zM0 1h4v1h-4zM5 1h4v1h-4zM0 2h2v1h-2zM7 2h2v1h-2zM0 3h1v1h-1zM8 3h1v1h-1z"
      />
      <path fill="#ffd34a" d="M4 1h1v1h-1zM2 2h5v1h-5zM1 3h3v1h-3zM5 3h3v1h-3zM1 4h2v1h-2zM6 4h2v1h-2z" />
      <path fill="#fff1a0" d="M4 3h1v1h-1zM3 4h3v1h-3z" />
      <path fill="#f7a14a" d="M0 4h1v1h-1zM8 4h1v1h-1z" />
      <path fill="#3d7ad6" d="M0 5h9v1h-9zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h3v1h-3zM6 7h3v1h-3zM0 8h9v1h-9z" />
      <path fill="#9cc4f5" d="M1 6h7v1h-7zM3 7h3v1h-3z" />
    </svg>
  )
}

/* -------------------------------------------------------------------- style */

const CARD_STYLE: CSSProperties = {
  width: 220,
  height: 116,
  boxSizing: 'border-box',
  padding: '16px 14px 14px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: '#121b44',
  border: '4px solid #3a4c8c',
  borderRadius: 0,
  boxShadow: '4px 4px 0 #070d26, inset 0 4px 0 #22306a',
  color: '#f3efe6',
  fontFamily: "'VT323', monospace",
  fontSize: 22,
  lineHeight: 1.15,
  textAlign: 'center',
  cursor: 'pointer',
}

export default function GamesMenu() {
  const { language, route, tapTarget } = useSmaran()
  const navigate = useNavigate()
  const scale = useStageScale()

  // The day's routing still runs; it just no longer decides which cards
  // exist, only which one gets a quiet "today" mark.
  const suggested = route.games[0]

  return (
    <div className="px-viewport">
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <PixelPond recede />
      </div>

      <div className="plaque-fade absolute inset-0 z-20 flex flex-col items-center justify-center px-6">
        <h1
          className="text-center"
          style={{
            fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
            fontSize: 'clamp(26px, 3.6vw, 42px)',
            color: '#f5f0e6',
            textShadow: '4px 4px 0 #070d26',
          }}
        >
          {t(language, 'todaysGames')}
        </h1>

        <div className="mt-9 flex flex-wrap items-stretch justify-center gap-5" style={{ maxWidth: 780 }}>
          {ENTRIES.map((e) => {
            const Icon = e.icon
            const isSuggested = e.key === suggested
            return (
              <button
                key={e.key}
                type="button"
                onClick={() => navigate(e.path)}
                style={{ ...CARD_STYLE, minHeight: Math.max(116, tapTarget + 40) }}
              >
                <Icon />
                <span>{e.label}</span>
                {isSuggested && (
                  <span style={{ fontSize: 14, color: '#f0c94a', letterSpacing: '0.08em' }}>
                    {TODAY_TAG[language] ?? TODAY_TAG.en}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            marginTop: 40,
            minHeight: 56,
            padding: '10px 24px',
            background: 'none',
            border: 0,
            color: '#c4cce0',
            fontFamily: "'VT323', monospace",
            fontSize: 24,
            textDecoration: 'underline',
            textUnderlineOffset: 5,
            cursor: 'pointer',
          }}
        >
          ← {t(language, 'goHome')}
        </button>
      </div>
    </div>
  )
}

const TODAY_TAG: Record<string, string> = {
  en: 'suggested today',
  as: 'আজিৰ বাবে',
  mni: 'ঙসিগীদমক',
  lus: 'vawiin atân',
  hi: 'आज के लिए',
  nag: 'aji nimite',
}
