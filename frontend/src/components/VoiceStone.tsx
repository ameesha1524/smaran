import { useEffect, useRef, useState } from 'react'
import { listenOnce, listeningSupported, onSpeakingChange, speak, stopSpeaking, type VoiceIntent } from '../lib/speechEngine'
import { t } from '../i18n/strings'
import type { LanguageCode } from '../lib/types'

/**
 * The voice button: a river stone with a leaf on it.
 *
 * It is on every screen, it is always the largest touch target, and it always
 * does the same thing — press it and Smaran reads the screen aloud in her
 * language. Press it again while it is talking and it listens instead.
 */

export interface VoiceStoneProps {
  language: LanguageCode
  /** What gets read aloud when the stone is pressed. */
  text: string
  /** Read it once, unprompted, this long after mount. 0 disables. */
  autoSpeakAfterMs?: number
  onIntent?: (intent: VoiceIntent) => void
  size?: number
  className?: string
}

export default function VoiceStone({
  language,
  text,
  autoSpeakAfterMs = 0,
  onIntent,
  size = 116,
  className = '',
}: VoiceStoneProps) {
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const stopListening = useRef<(() => void) | null>(null)
  const spokeOnce = useRef(false)

  useEffect(() => onSpeakingChange(setSpeaking), [])

  useEffect(() => {
    if (!autoSpeakAfterMs || spokeOnce.current) return
    // A patient who has asked for less motion has not asked for less voice, but
    // an unprompted voice is still a surprise — honour the same preference.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setTimeout(() => {
      spokeOnce.current = true
      void speak(text, { language })
    }, autoSpeakAfterMs)
    return () => window.clearTimeout(id)
  }, [autoSpeakAfterMs, text, language])

  useEffect(() => () => stopSpeaking(), [])

  const press = () => {
    if (speaking) {
      stopSpeaking()
      if (listeningSupported() && onIntent) {
        setListening(true)
        stopListening.current = listenOnce(language, (intent) => {
          setListening(false)
          onIntent(intent)
        })
      }
      return
    }
    if (listening) {
      stopListening.current?.()
      setListening(false)
      return
    }
    void speak(text, { language })
  }

  const label = listening ? 'listening…' : speaking ? t(language, 'speaking') : t(language, 'voiceIdle')

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="relative" style={{ width: size, height: size * 0.82 }}>
        <span className="pulse-ring" aria-hidden="true" />
        <span className="pulse-ring delay" aria-hidden="true" />
        <button
          type="button"
          onClick={press}
          className={`stone relative z-10 flex h-full w-full flex-col items-center justify-center gap-1 ${speaking || listening ? 'speaking' : ''}`}
          aria-label={`${t(language, 'speak')} — ${label}`}
        >
          <span
            className="font-sans"
            style={{ fontSize: 12, letterSpacing: '0.18em', color: 'var(--chalk-dim)' }}
          >
            {t(language, 'speak')}
          </span>
          {/* a leaf: two petal paths and a stem */}
          <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 48 48" aria-hidden="true">
            <path
              d="M24,42 C10,34 8,16 24,6 C40,16 38,34 24,42 Z"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="1.6"
              opacity={speaking ? 1 : 0.85}
            />
            <path d="M24,42 C22,30 22,18 24,6" fill="none" stroke="var(--gold)" strokeWidth="1.2" opacity="0.8" />
            <path d="M24,26 l-8,-6 M24,20 l8,-6 M24,32 l-7,-5" stroke="var(--gold)" strokeWidth="0.9" opacity="0.6" />
          </svg>
        </button>
      </div>
      <p
        className="mt-2 text-center font-sans"
        style={{ fontSize: 14, color: 'var(--chalk-dim)', opacity: 0.85 }}
        aria-live="polite"
      >
        {label}
      </p>
    </div>
  )
}
