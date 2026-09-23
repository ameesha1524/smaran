import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PixelPond, { useStageScale } from '../scenes/PixelPond'
import { FLOWER_TONE, FlowerBloom, FlowerBud } from '../components/LanguageFlower'
import { LANGUAGES, LANGUAGE_ORDER } from '../i18n/strings'
import { useSmaran } from '../state/SmaranContext'
import type { LanguageCode } from '../lib/types'

/**
 * The first thing Smaran ever asks, and the only time it asks it.
 *
 * Six flowers on the water, one per language, each a different bloom rather
 * than a different label — a patient who can no longer read her own script can
 * still recognise "mine is the purple one". Touching one saves the choice to
 * the device and the question never appears again; the landing screen carries
 * no language bar at all afterwards. Changing it later is a caregiver action,
 * under Settings → Language.
 */

export default function LanguageChoice() {
  const { chooseLanguage } = useSmaran()
  const navigate = useNavigate()
  const scale = useStageScale()
  const [picked, setPicked] = useState<LanguageCode | null>(null)

  const pick = (code: LanguageCode) => {
    if (picked) return
    setPicked(code)
    chooseLanguage(code)
    // A beat, so the chosen bloom is seen to open before the screen changes.
    window.setTimeout(() => navigate('/', { replace: true }), 1100)
  }

  return (
    <div className="px-viewport">
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <PixelPond recede />
      </div>

      <div className="plaque-fade absolute inset-0 z-20 flex flex-col items-center justify-center px-6">
        <h1
          className="text-center"
          style={{
            fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', sans-serif",
            fontSize: 'clamp(24px, 3.4vw, 40px)',
            color: '#f5f0e6',
            textShadow: '4px 4px 0 #070d26',
          }}
        >
          নমস্কাৰ · নমস्ते · Hello
        </h1>
        <p className="mt-3 text-center font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
          Touch a flower
        </p>

        <div
          className="mt-10 flex flex-wrap items-end justify-center gap-x-8 gap-y-10"
          role="radiogroup"
          aria-label="Choose a language"
        >
          {LANGUAGE_ORDER.map((code) => {
            const pack = LANGUAGES[code]
            const tone = FLOWER_TONE[code] ?? 'white'
            const isPicked = picked === code
            const faded = picked !== null && !isPicked
            return (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={isPicked}
                aria-label={`${pack.latinLabel} — ${pack.label}`}
                onClick={() => pick(code)}
                className="flex flex-col items-center justify-end"
                style={{
                  minWidth: 132,
                  minHeight: 132,
                  opacity: faded ? 0.18 : 1,
                  transform: isPicked ? 'scale(1.16)' : 'scale(1)',
                  transition: 'opacity 900ms ease-in-out, transform 900ms ease-in-out',
                }}
              >
                {/* The bud opens only once it is the chosen one. */}
                <span style={{ display: 'flex', alignItems: 'flex-end', height: 104 }}>
                  {isPicked ? <FlowerBloom tone={tone} /> : <FlowerBud tone={tone} scale={5} />}
                </span>
                <span
                  className="mt-2 text-center"
                  style={{
                    fontSize: 22,
                    color: isPicked ? '#f0c94a' : '#dbe1ee',
                    fontFamily: "'Noto Sans', system-ui, sans-serif",
                    textShadow: '2px 2px 0 #070d26',
                  }}
                >
                  {pack.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
