import type { ReactNode, RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import Sanctuary from '../scenes/Sanctuary'
import VoiceStone from './VoiceStone'
import { useSmaran } from '../state/SmaranContext'
import { t } from '../i18n/strings'

/**
 * The frame every game sits in.
 *
 * The pond never goes away — it recedes. She is always somewhere she recognises,
 * and the way back to it is always in the same place, always phrased as a
 * return rather than an exit. There is no close button, no X, no "quit".
 */

export interface GameShellProps {
  title: string
  /** Read aloud by the stone. Should be the instruction, in plain words. */
  spoken: string
  /** Cognitive domain badge — for caregivers reading over her shoulder. */
  tag?: string
  children: ReactNode
  /** Hidden camera element for face geometry; supplied by useAdaptiveSession. */
  videoRef?: RefObject<HTMLVideoElement>
  footer?: ReactNode
  onExit?: () => void
}

export default function GameShell({ title, spoken, tag, children, videoRef, footer, onExit }: GameShellProps) {
  const { phase, gardenState, language, stillness } = useSmaran()
  const navigate = useNavigate()

  const leave = () => {
    onExit?.()
    navigate('/')
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <Sanctuary phase={phase} bloomStage={gardenState.bloomStage} still={stillness} recede />

      {/* Face geometry never renders to the screen; the element exists only so
          MediaPipe has a video source. No frame is stored or transmitted. */}
      {videoRef && <video ref={videoRef} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />}

      <div className="relative z-20 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="inscription font-serif" style={{ fontSize: 'clamp(26px, 3.6vw, 44px)' }}>
              {title}
            </h1>
            {tag && (
              <span
                className="mt-1 inline-block font-sans"
                style={{ fontSize: 13, letterSpacing: '0.12em', color: 'var(--chalk-dim)', opacity: 0.75 }}
              >
                {tag}
              </span>
            )}
          </div>
          <VoiceStone language={language} text={spoken} size={92} />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center py-6">{children}</main>

        <footer className="flex items-center justify-between gap-4 pb-2">
          <button type="button" onClick={leave} className="pill stone" style={{ padding: '12px 26px' }}>
            {t(language, 'goHome')}
          </button>
          <div className="flex items-center gap-4">{footer}</div>
        </footer>
      </div>
    </div>
  )
}

/**
 * The end of a session. Never a score screen: a count of what opened, the
 * domains she touched, and one way onward. Every session ends in success.
 */
export function SessionComplete({
  blooms,
  domains,
  onAgain,
  onHome,
  language,
}: {
  blooms: number
  domains: string[]
  onAgain(): void
  onHome(): void
  language: string
}) {
  return (
    <div className="plaque-fade flex flex-col items-center gap-7 text-center">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <path
            key={deg}
            d="M70,70 C63,48 65,28 70,16 C75,28 77,48 70,70 Z"
            fill="var(--lotus-white)"
            fillOpacity="0.2"
            stroke="var(--lotus-white)"
            strokeWidth="1.1"
            transform={`rotate(${deg} 70 70)`}
          />
        ))}
        <circle cx="70" cy="70" r="8" fill="var(--gold)" opacity="0.9" />
      </svg>

      <h2 className="inscription font-serif" style={{ fontSize: 'clamp(24px, 3.4vw, 40px)' }}>
        {blooms === 1 ? 'A lotus opened' : `${blooms} lotuses opened`}
      </h2>
      <p className="font-serif italic" style={{ fontSize: 20, color: 'var(--gold-soft)' }}>
        Your garden drank today.
      </p>

      {domains.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {domains.map((d) => (
            <span
              key={d}
              className="rounded-full px-4 py-1 font-sans"
              style={{ fontSize: 13, color: 'var(--chalk-dim)', border: '1px solid rgba(221,234,248,0.2)' }}
            >
              {d}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
        <button type="button" onClick={onAgain} className="pill" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
          {t(language, 'playAgain')}
        </button>
        <button type="button" onClick={onHome} className="pill stone">
          {t(language, 'goHome')}
        </button>
      </div>
    </div>
  )
}
