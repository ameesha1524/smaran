import { bloomCopy, stageProgress } from '../lib/gardenEngine'
import type { GardenState } from '../lib/types'

/**
 * The garden progress "bar" — a vine that grows buds, not a percentage.
 *
 * There is no number anywhere in this component, and there is no empty state
 * that reads as failure: a garden at stage 1 is soil that is *ready*, and a
 * sleeping garden is sleeping, not neglected.
 */

const STAGE_GLYPHS = ['🌱', '🎋', '🌸', '🌳'] as const

export default function GardenBar({ state, compact = false }: { state: GardenState; compact?: boolean }) {
  const progress = stageProgress(state.growthPoints)
  const stage = state.bloomStage

  return (
    <div className="flex items-center gap-3" aria-label={bloomCopy(state)}>
      <svg width={compact ? 150 : 210} height={compact ? 26 : 34} viewBox="0 0 210 34" aria-hidden="true">
        {/* the vine */}
        <path
          d="M4,26 C44,10 84,32 124,18 C154,8 180,22 206,14"
          fill="none"
          stroke="var(--olive-light)"
          strokeWidth="1.6"
          opacity="0.55"
        />
        {/* how far along it she is — drawn as a brighter, thicker stretch */}
        <path
          d="M4,26 C44,10 84,32 124,18 C154,8 180,22 206,14"
          fill="none"
          stroke="var(--gold)"
          strokeWidth="2.2"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - Math.min(1, (stage - 1 + progress) / 4)}
          style={{ transition: 'stroke-dashoffset 2.4s ease-in-out' }}
          opacity="0.9"
        />
        {[0, 1, 2, 3].map((i) => {
          const x = 30 + i * 56
          const y = [22, 24, 18, 15][i]
          const reached = stage > i + 1 || (stage === i + 1 && progress > 0.05)
          const current = stage === i + 1
          return (
            <g key={i} opacity={reached || current ? 1 : 0.32}>
              {current && !state.restingPhase && (
                <circle cx={x} cy={y} r="9" fill="var(--gold)" opacity="0.16" />
              )}
              <text x={x} y={y + 5} fontSize="14" textAnchor="middle">
                {STAGE_GLYPHS[i]}
              </text>
            </g>
          )
        })}
      </svg>
      {!compact && (
        <span
          className="font-serif italic"
          style={{ fontSize: 17, color: state.restingPhase ? 'var(--chalk-dim)' : 'var(--gold-soft)' }}
        >
          {bloomCopy(state)}
        </span>
      )}
    </div>
  )
}
