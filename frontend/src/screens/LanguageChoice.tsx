import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PixelPond, { useStageScale } from '../scenes/PixelPond'
import { FLOWER_TONE, FlowerBloom, FlowerBud } from '../components/LanguageFlower'
import { LANGUAGES, LANGUAGE_ORDER, buildGreeting, getPack, translateKinshipTerm } from '../i18n/strings'
import { useSmaran } from '../state/SmaranContext'
import type { LanguageCode } from '../lib/types'

/**
 * The one thing Smaran ever asks her, and it asks it as a confirmation.
 *
 * The caregiver has already set a language during setup, so the honest question
 * is not "which of six?" but "is this yours?" — greeting her in the language
 * already chosen and letting her say yes. A person who cannot read six scripts
 * can still recognise being spoken to correctly.
 *
 * Changing it is still possible, and still uses the six flowers: one bloom per
 * language rather than one label, so recognition does not depend on literacy.
 * Either way the question retires permanently once answered.
 */

export default function LanguageChoice() {
  const { language, patient, confirmLanguage } = useSmaran()
  const navigate = useNavigate()
  const scale = useStageScale()
  const [choosing, setChoosing] = useState(false)
  const [picked, setPicked] = useState<LanguageCode | null>(null)

  const settle = (code: LanguageCode) => {
    if (picked) return
    setPicked(code)
    confirmLanguage(code)
    // A beat, so the chosen bloom is seen to open before the screen changes.
    window.setTimeout(() => navigate('/', { replace: true }), 1100)
  }

  const kin = translateKinshipTerm(patient.name?.trim() || patient.kinshipTerm, language)
  const greeting = buildGreeting(language, kin)
  const pack = getPack(language)

  return (
    <div className="px-viewport">
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <PixelPond recede />
      </div>

      <div className="plaque-fade absolute inset-0 z-20 flex flex-col items-center justify-center px-6">
        {!choosing ? (
          <>
            {/* Greeted first, asked second — she hears her language before judging it. */}
            <h1
              className="text-center"
              style={{
                fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
                fontSize: 'clamp(28px, 4.2vw, 52px)',
                color: '#f5f0e6',
                textShadow: '4px 4px 0 #070d26',
              }}
            >
              {greeting.greeting}
            </h1>
            <p
              className="mt-3 text-center"
              style={{
                fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
                fontSize: 'clamp(20px, 2.6vw, 32px)',
                color: '#f0c94a',
                textShadow: '3px 3px 0 #3a2c08',
              }}
            >
              {greeting.goldLine}
            </p>

            <button
              type="button"
              onClick={() => settle(language)}
              className="mt-12"
              style={{
                minHeight: 96,
                padding: '22px 44px',
                background: '#121b44',
                border: '4px solid #3a4c8c',
                borderRadius: 0,
                boxShadow: '4px 4px 0 #070d26, inset 0 4px 0 #22306a',
                color: '#f3efe6',
                fontFamily: "'Noto Sans', system-ui, sans-serif",
                fontSize: 26,
                lineHeight: 1.2,
                cursor: 'pointer',
              }}
            >
              {CONFIRM_LABEL[language] ?? CONFIRM_LABEL.en} · {pack.label}
            </button>

            <button
              type="button"
              onClick={() => setChoosing(true)}
              className="mt-7"
              style={{
                minHeight: 56,
                padding: '10px 24px',
                background: 'none',
                border: 0,
                color: '#c4cce0',
                fontFamily: "'Noto Sans', system-ui, sans-serif",
                fontSize: 19,
                textDecoration: 'underline',
                textUnderlineOffset: 5,
                cursor: 'pointer',
              }}
            >
              {CHANGE_LABEL[language] ?? CHANGE_LABEL.en}
            </button>
          </>
        ) : (
          <>
            <h1
              className="text-center"
              style={{
                fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', sans-serif",
                fontSize: 'clamp(24px, 3.4vw, 40px)',
                color: '#f5f0e6',
                textShadow: '4px 4px 0 #070d26',
              }}
            >
              নমস্কাৰ · नमस्ते · Hello
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
                const p = LANGUAGES[code]
                const tone = FLOWER_TONE[code] ?? 'white'
                const isPicked = picked === code
                const faded = picked !== null && !isPicked
                return (
                  <button
                    key={code}
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    aria-label={`${p.latinLabel} — ${p.label}`}
                    onClick={() => settle(code)}
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
                      {p.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* These two live here rather than in the UI pack because they are asked exactly
   once per device, before any other screen has spoken. */

const CONFIRM_LABEL: Record<string, string> = {
  en: 'Yes, this is my language',
  as: 'হয়, এইটোৱেই মোৰ ভাষা',
  mni: 'হোই, মসি ইনি লোল',
  lus: 'Aw, hei hi ka ṭawng a ni',
  hi: 'हाँ, यही मेरी भाषा है',
  nag: 'Hoi, etu moi laga bhasa ase',
}

const CHANGE_LABEL: Record<string, string> = {
  en: 'Change language',
  as: 'ভাষা সলনি কৰক',
  mni: 'লোল হোংদোকপা',
  lus: 'Ṭawng thlâk',
  hi: 'भाषा बदलें',
  nag: 'Bhasa bodli koribi',
}
