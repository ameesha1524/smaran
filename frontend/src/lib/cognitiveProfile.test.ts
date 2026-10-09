import { describe, expect, it } from 'vitest'
import { emptyProfile, scoringStateOf, updateProfile } from './cognitiveProfile'
import type { ScoreContribution } from './scoring/types'
import type { CognitiveProfile } from './types'

const when = { startedAt: Date.parse('2026-10-06T04:30:00Z') }
const c = (target: ScoreContribution['target'], raw: number, confidence = 1): ScoreContribution => ({
  target,
  raw,
  confidence,
  because: 'test',
})

describe('updateProfile', () => {
  it('a new profile starts every domain at 50', () => {
    const state = scoringStateOf(emptyProfile('p'))
    expect(Object.values(state).map((t) => t!.level)).toEqual([50, 50, 50, 50, 50, 50])
  })

  it('one visit changes the profile exactly once, and only the targets it spoke to', () => {
    const before = emptyProfile('p')
    const after = updateProfile(before, when, [c('MOTOR', 100)])
    expect(after.scoring!.MOTOR!.observations).toBe(1)
    expect(after.scoring!.MOTOR!.level).toBe(62.5)
    expect(after.domainScores.motor).toBe(0.625)
    for (const other of ['LANGUAGE', 'VISUAL_SEMANTIC', 'AFFECTIVE', 'TEMPORAL', 'EXECUTIVE'] as const) {
      expect(after.scoring![other]!.observations).toBe(0)
    }
    expect(after.domainScores.language).toBe(before.domainScores.language)
  })

  it('a visit that speaks to four domains moves each of them once', () => {
    const after = updateProfile(emptyProfile('p'), when, [
      c('VISUAL_SEMANTIC', 80, 0.9),
      c('MOTOR', 70, 0.8),
      c('AFFECTIVE', 60, 0.36),
      c('TEMPORAL', 50, 0.2),
    ])
    const seen = Object.entries(after.scoring!).filter(([, t]) => t!.observations > 0)
    expect(seen.map(([k]) => k).sort()).toEqual(['AFFECTIVE', 'MOTOR', 'TEMPORAL', 'VISUAL_SEMANTIC'])
    expect(seen.every(([, t]) => t!.observations === 1)).toBe(true)
    expect(after.scoring!.VISUAL_SEMANTIC!.level).toBeCloseTo(50 * (1 - 0.225) + 80 * 0.225, 12)
  })

  it('a sub-signal is kept beside the domains, and does not move one', () => {
    const after = updateProfile(emptyProfile('p'), when, [c('WORKING_MEMORY_SPAN', 100)])
    expect(after.scoring!.WORKING_MEMORY_SPAN!.level).toBe(62.5)
    expect(after.domainScores.executiveFunction).toBe(0.5)
  })

  it('a profile saved before the engine keeps its levels and starts its history fresh', () => {
    const legacy: CognitiveProfile = {
      ...emptyProfile('p'),
      domainScores: { language: 0.6, visualSemantic: 0.6, motor: 0.6, affective: 0.7, temporal: 0.6, executiveFunction: 0.6 },
    }
    const after = updateProfile(legacy, when, [c('MOTOR', 100)])
    expect(after.domainScores.motor).toBe(0.7)
    expect(after.scoring!.AFFECTIVE!.level).toBe(70)
  })

  it('does not mutate the profile it was given', () => {
    const before = emptyProfile('p')
    const snapshot = JSON.stringify(before)
    updateProfile(before, when, [c('MOTOR', 100)])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
