import { useMemo, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PixelPond, { STAGE_W, useStageScale } from '../scenes/PixelPond'
import MoodCheckIn from '../components/MoodCheckIn'
import SyncIndicator from '../components/SyncIndicator'
import { useSmaran } from '../state/SmaranContext'
import { buildGreeting, spokenGreeting, t, translateKinshipTerm } from '../i18n/strings'
import { speak } from '../lib/speechEngine'
import type { GameType, MoodKey } from '../lib/types'

/**
 * The sanctuary home screen, drawn in pixel art.
 *
 * Every position below is in the scene's own 1440x810 coordinates, and the
 * whole stage scales as one piece, so the voice stone stays on the water and
 * the flowers stay at its edge on any screen.
 *
 * The visual grammar is borrowed from 8-bit games and applied without
 * exception: hard offset shadows instead of blurs, four-pixel borders instead
 * of hairlines, and no rounded corners. A single soft edge would give the
 * whole thing away, which is why there is no `border-radius` on this screen
 * apart from the stone's ring, where a circle is the point.
 */

const GAME_ROUTES: Record<GameType, { path: string; label: string }> = {
  WEAVERS_LOOM: { path: '/game/weavers-loom', label: "The Weaver's Loom" },
  GRANDMOTHERS_TALE: { path: '/game/grandmothers-tale', label: "Grandmother's Tale" },
  FAMILY_GROVE: { path: '/game/family-grove', label: 'Family Grove' },
  MORNING_RITUALS: { path: '/game/morning-rituals', label: 'Morning Rituals' },
}

/**
 * Indic scripts have no pixel face, so they fall back to Noto and sit a little
 * smaller, which keeps their optical weight level with the pixel type beside
 * them rather than letting them shout.
 */
const SCRIPT: Record<string, { font: string; size: number }> = {
  as: { font: "'Noto Sans Bengali', sans-serif", size: 16 },
  mni: { font: "'Noto Sans Bengali', sans-serif", size: 16 },
  hi: { font: "'Noto Sans Devanagari', sans-serif", size: 16 },
}

/* ------------------------------------------------------------------ sprites */

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

/** The voice stone: a gold-rimmed boulder sitting in the shallows. */
function StoneFace() {
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
      {/* The lit shoulder, where the moon catches the stone. */}
      <path
        fill="#26346a"
        d="M9 6h4v1h-4zM8 7h6v1h-6zM7 8h8v1h-8zM7 9h8v1h-8zM7 10h8v1h-8zM8 11h6v1h-6zM9 12h4v1h-4z"
      />
    </svg>
  )
}

function LotusGlyph() {
  return (
    <svg width="28" height="32" viewBox="0 0 7 8" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill="#e6c55a"
        d="M3 0h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM1 3h2v1h-2zM4 3h2v1h-2zM1 4h1v1h-1zM3 4h1v1h-1zM5 4h1v1h-1zM2 5h1v1h-1zM4 5h1v1h-1zM3 6h1v1h-1zM3 7h1v1h-1z"
      />
      <path
        fill="#1a254f"
        d="M3 1h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM3 5h1v1h-1z"
      />
    </svg>
  )
}

/* -------------------------------------------------------------------- style */

/** Hard shadow down-right, hard highlight along the top: a raised 8-bit panel. */
const CARD_STYLE: CSSProperties = {
  height: 104,
  boxSizing: 'border-box',
  padding: '14px 12px 12px',
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
  fontSize: 24,
  lineHeight: 1,
  cursor: 'pointer',
}

const SHADOW = '2px 2px 0 #070d26'

export default function Home() {
  const { patient, language, needsCheckIn, checkIn, route, stillness, tapTarget } = useSmaran()
  const navigate = useNavigate()
  const scale = useStageScale()

  const displayName = patient.name?.trim() || patient.kinshipTerm
  const kin = useMemo(() => translateKinshipTerm(displayName, language), [language, displayName])
  const greeting = useMemo(() => buildGreeting(language, kin), [language, kin])
  const spoken = useMemo(() => spokenGreeting(language, kin), [language, kin])

  const onMood = async (mood: MoodKey) => {
    await checkIn(mood)
  }

  const games = route.games.slice(0, 2).map((g) => ({ key: g, ...GAME_ROUTES[g] }))

  return (
    <div className={`px-viewport ${stillness ? 'still' : ''}`}>
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <PixelPond recede={needsCheckIn} />

        {/* ------------------------------------------------ the emotion check-in */}
        {needsCheckIn && (
          <div
            className="plaque-fade"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MoodCheckIn variant="three" onPick={onMood} prompt={t(language, 'howAreYou')} tapTarget={tapTarget} />
          </div>
        )}

        {!needsCheckIn && (
          <>
            {/* ------------------------------------------------ greeting */}
            <div
              className="plaque-fade"
              style={{
                position: 'absolute',
                left: 0,
                top: 64,
                width: STAGE_W,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  fontFamily: "'VT323', monospace",
                  fontSize: 22,
                  letterSpacing: '0.42em',
                  textTransform: 'uppercase',
                  color: '#aeb7cc',
                }}
              >
                {t(language, 'appName')}
              </div>
              <div
                key={language}
                className="greeting-swap"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
              >
                <h1
                  style={{
                    margin: '14px 0 0 0',
                    fontFamily: `'Pixelify Sans', ${SCRIPT[language]?.font ?? 'sans-serif'}`,
                    fontWeight: 600,
                    fontSize: 60,
                    lineHeight: 1.1,
                    color: '#f5f0e6',
                    textShadow: '4px 4px 0 #070d26',
                  }}
                >
                  {greeting.greeting}
                </h1>
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: `'Pixelify Sans', ${SCRIPT[language]?.font ?? 'sans-serif'}`,
                    fontSize: 44,
                    lineHeight: 1.15,
                    color: '#f0c94a',
                    textShadow: '4px 4px 0 #3a2c08',
                  }}
                >
                  {greeting.goldLine}
                </div>
                <p
                  style={{
                    margin: '20px 0 0 0',
                    fontFamily: SCRIPT[language]?.font ?? "'VT323', monospace",
                    fontSize: SCRIPT[language] ? 20 : 26,
                    lineHeight: 1.3,
                    color: '#d2d8e7',
                    textShadow: SHADOW,
                  }}
                >
                  {greeting.sub}
                </p>
              </div>
            </div>

            {/* ------------------------------------------- the garden's one line */}
            <div
              style={{
                position: 'absolute',
                left: 772,
                top: 318,
                fontFamily: "'Pixelify Sans', sans-serif",
                fontSize: 22,
                color: '#f0c94a',
                textShadow: '2px 2px 0 #3a2c08',
              }}
            >
              {t(language, 'gardenSeed')}
            </div>

            {/* ------------------------------------------- today's two choices */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 362,
                width: STAGE_W,
                display: 'flex',
                justifyContent: 'center',
                gap: 20,
              }}
            >
              {games.map((g, i) => (
                <button
                  key={g.key}
                  type="button"
                  className="px-card"
                  onClick={() => navigate(g.path)}
                  style={{ ...CARD_STYLE, minWidth: Math.max(tapTarget, i === 0 ? 152 : 172) }}
                >
                  {g.key === 'MORNING_RITUALS' ? <SunriseIcon /> : <TreeIcon />}
                  <span>{g.label}</span>
                </button>
              ))}
            </div>

            {/* ------------------------------------------------------ the stone */}
            <div
              className="px-stone-ring"
              style={{
                position: 'absolute',
                left: 648,
                top: 604,
                width: 144,
                height: 144,
                boxSizing: 'border-box',
                border: '4px dashed rgba(240,201,74,0.35)',
                borderRadius: '50%',
                pointerEvents: 'none',
              }}
            />
            <button
              type="button"
              className="px-stone"
              onClick={() => void speak(spoken, { language })}
              aria-label={`${t(language, 'speak')} — ${t(language, 'voiceIdle')}`}
              style={{
                position: 'absolute',
                left: 661,
                top: 617,
                width: 118,
                height: 118,
                padding: 0,
                border: 0,
                background: 'none',
                cursor: 'pointer',
              }}
            >
              <span style={{ position: 'absolute', left: 0, top: 0 }}>
                <StoneFace />
              </span>
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 24,
                  width: 118,
                  textAlign: 'center',
                  fontFamily: "'VT323', monospace",
                  fontSize: 22,
                  letterSpacing: '0.2em',
                  color: '#dbe1ee',
                }}
              >
                {t(language, 'speak')}
              </span>
              <span style={{ position: 'absolute', left: 45, top: 54 }}>
                <LotusGlyph />
              </span>
            </button>

            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 752,
                width: STAGE_W,
                textAlign: 'center',
                fontFamily: "'VT323', monospace",
                fontSize: 24,
                color: '#c8cfdf',
                textShadow: SHADOW,
                pointerEvents: 'none',
              }}
            >
              {t(language, 'voiceIdle')}
            </div>
          </>
        )}
      </div>

      {/* ------------- pinned to the screen, outside the water, never cropped -- */}
      {!needsCheckIn && (
        <>
          <SyncIndicator className="px-corner-sync" />
          <Link
            to="/caregiver"
            style={{
              position: 'absolute',
              right: 26,
              bottom: 18,
              fontFamily: "'VT323', monospace",
              fontSize: 24,
              textUnderlineOffset: 4,
              color: '#c4cce0',
            }}
          >
            {t(language, 'caregiverLink')}
          </Link>
        </>
      )}
    </div>
  )
}
