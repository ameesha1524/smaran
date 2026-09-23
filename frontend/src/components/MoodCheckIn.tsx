import type { MoodKey } from '../lib/types'

/**
 * The emotion check-in.
 *
 * Two shapes of the same idea: three faces on opening the sanctuary, eight
 * during onboarding. The labels are warm words — "A little low", "Restless",
 * "Peaceful" — never a scale, never a number, never a clinical term. The answer
 * is logged silently and nothing on screen reacts to it as a judgement.
 */

export const MOODS: { key: MoodKey; glyph: string; label: string }[] = [
  { key: 'JOYFUL', glyph: '🌻', label: 'Joyful' },
  { key: 'PEACEFUL', glyph: '🪷', label: 'Peaceful' },
  { key: 'QUIET', glyph: '🌙', label: 'Quiet' },
  { key: 'SLEEPY', glyph: '😴', label: 'Sleepy' },
  { key: 'A_LITTLE_LOW', glyph: '🌧', label: 'A little low' },
  { key: 'WORRIED', glyph: '🌫', label: 'Worried' },
  { key: 'RESTLESS', glyph: '🍃', label: 'Restless' },
  { key: 'THINKING', glyph: '🐚', label: 'Thinking' },
]

const THREE: MoodKey[] = ['JOYFUL', 'QUIET', 'A_LITTLE_LOW']

export interface MoodCheckInProps {
  variant?: 'three' | 'eight'
  value?: MoodKey | null
  onPick(mood: MoodKey): void
  prompt?: string
  tapTarget?: number
}

export default function MoodCheckIn({
  variant = 'three',
  value = null,
  onPick,
  prompt = 'How is today feeling?',
  tapTarget = 96,
}: MoodCheckInProps) {
  const moods = variant === 'three' ? MOODS.filter((m) => THREE.includes(m.key)) : MOODS

  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="inscription text-center font-serif" style={{ fontSize: 'clamp(24px, 3.2vw, 36px)' }}>
        {prompt}
      </h2>
      <div
        className={variant === 'three' ? 'flex flex-wrap justify-center gap-6' : 'grid grid-cols-2 gap-4 sm:grid-cols-4'}
      >
        {moods.map((m) => {
          const active = value === m.key
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onPick(m.key)}
              className="petal-card flex flex-col items-center justify-center gap-2 px-5 py-4"
              data-state={active ? 'correct' : undefined}
              style={{
                minWidth: Math.max(tapTarget, variant === 'three' ? 132 : 108),
                minHeight: Math.max(tapTarget, variant === 'three' ? 132 : 108),
              }}
              aria-pressed={active}
            >
              <span style={{ fontSize: variant === 'three' ? 46 : 34 }} aria-hidden="true">
                {m.glyph}
              </span>
              <span style={{ fontSize: 17, color: 'var(--chalk)' }}>{m.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
