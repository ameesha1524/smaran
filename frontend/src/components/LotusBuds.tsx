import { LANGUAGES, LANGUAGE_ORDER } from '../i18n/strings'
import type { LanguageCode } from '../lib/types'

/**
 * The language selector: six white lotus buds at the water's edge. Tapping one
 * blooms it — the petals open and the label appears in that language's own
 * script. No dropdown, no flags, no list of country names.
 */

export interface LotusBudsProps {
  value: LanguageCode
  onChange(code: LanguageCode): void
  /** Extra languages a caregiver added during setup. */
  extra?: { code: LanguageCode; label: string }[]
  size?: number
}

export default function LotusBuds({ value, onChange, extra = [], size = 72 }: LotusBudsProps) {
  const entries = [
    ...LANGUAGE_ORDER.map((code) => ({ code, label: LANGUAGES[code].label })),
    ...extra,
  ]

  return (
    <div className="flex flex-wrap items-end justify-center gap-3 sm:gap-5" role="radiogroup" aria-label="Language">
      {entries.map(({ code, label }) => {
        const active = code === value
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(code)}
            className="flex flex-col items-center justify-end"
            style={{ minWidth: size, opacity: active ? 1 : 0.62, transition: 'opacity 700ms ease-in-out' }}
          >
            <svg
              width={size}
              height={size}
              viewBox="0 0 64 64"
              aria-hidden="true"
              style={{
                filter: active ? 'drop-shadow(0 0 12px rgba(232,200,74,0.65))' : 'none',
                transition: 'filter 800ms ease-in-out',
              }}
            >
              {/* stem, rising out of the water */}
              <line x1="32" y1="62" x2="32" y2="40" stroke="var(--olive-light)" strokeWidth="1.6" />
              {/* four petals: closed as a bud, fanned open when chosen */}
              {[-1, 1].map((dir) =>
                [0, 1].map((tier) => {
                  const spread = active ? (tier ? 34 : 16) : tier ? 12 : 5
                  const lift = active ? (tier ? 2 : 0) : tier ? 6 : 3
                  return (
                    <path
                      key={`${dir}-${tier}`}
                      d={`M32,${40 + lift} C${32 + dir * (spread * 0.5)},${28 + lift} ${32 + dir * spread * 0.8},${16 + lift} 32,${6 + lift} C${32 - dir * spread * 0.2},${18 + lift} ${32 - dir * spread * 0.1},${30 + lift} 32,${40 + lift} Z`}
                      fill="var(--lotus-white)"
                      fillOpacity={active ? 0.2 : 0.08}
                      stroke="var(--lotus-white)"
                      strokeWidth="1.1"
                      style={{ transition: 'd 900ms ease-in-out' }}
                    />
                  )
                }),
              )}
              <circle cx="32" cy={active ? 26 : 32} r={active ? 4.2 : 3} fill="var(--gold)" opacity={active ? 1 : 0.7} />
              {/* ripple where the stem meets the water, only for the open one */}
              {active && (
                <ellipse cx="32" cy="62" rx="13" ry="3" fill="none" stroke="var(--lotus-white)" strokeWidth="0.8" opacity="0.45" />
              )}
            </svg>
            <span
              className="mt-1 text-center"
              style={{
                fontSize: 15,
                color: active ? 'var(--chalk)' : 'var(--chalk-dim)',
                fontFamily: "'Noto Sans', system-ui, sans-serif",
              }}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
