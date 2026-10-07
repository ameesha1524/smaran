import { describe, expect, it } from 'vitest'
import { emptyProfile, scoringStateOf, updateProfile } from './cognitiveProfile'
import type { CognitiveProfile, SessionResultDraft } from './types'

const draft = (over: Partial<SessionResultDraft>): SessionResultDraft => ({
  gameType: 'KOI_ARE_JUMPING',
  startedAt: Date.parse('2026-10-06T04:30:00Z'),
  durationMs: 60_000,
  completionRate: 0.5,
  difficultyTier: 1,
  cognitiveLoadScore: 0.2,
  moodAtStart: 'QUIET',
  ...over,
})

describe('updateProfile', () => {
  it('a new profile starts every domain at 50', () => {
    const state = scoringStateOf(emptyProfile('p'))
    expect(Object.values(state).map((t) => t!.level)).toEqual([50, 50, 50, 50, 50, 50])
  })

  it('one visit changes the profile exactly once, and only the domains it read', () => {
    const before = emptyProfile('p')
    const after = updateProfile(before, draft({ domainReadings: { motor: { score: 1, confidence: 1 } } }))
    expect(after.scoring!.MOTOR!.observations).toBe(1)
    expect(after.scoring!.MOTOR!.level).toBe(62.5)
    expect(after.domainScores.motor).toBe(0.625)
    for (const other of ['LANGUAGE', 'VISUAL_SEMANTIC', 'AFFECTIVE', 'TEMPORAL', 'EXECUTIVE'] as const) {
      expect(after.scoring![other]!.observations).toBe(0)
    }
    expect(after.domainScores.language).toBe(before.domainScores.language)
  })

  it('a Lotus Frog visit goes through the same path as every other game, once per domain', () => {
    const after = updateProfile(
      emptyProfile('p'),
      draft({
        gameType: 'LOTUS_FROG',
        domainReadings: {
          visualSemantic: { score: 0.8, confidence: 0.9 },
          motor: { score: 0.7, confidence: 0.8 },
          affective: { score: 0.6, confidence: 0.36 },
          temporal: { score: 0.5, confidence: 0.2 },
        },
      }),
    )
    const seen = Object.entries(after.scoring!).filter(([, t]) => t!.observations > 0)
    expect(seen.map(([k]) => k).sort()).toEqual(['AFFECTIVE', 'MOTOR', 'TEMPORAL', 'VISUAL_SEMANTIC'])
    expect(seen.every(([, t]) => t!.observations === 1)).toBe(true)
    expect(after.scoring!.VISUAL_SEMANTIC!.level).toBeCloseTo(50 * (1 - 0.225) + 80 * 0.225, 12)
  })

  it('a game with no readings is read as its completion rate against its primary domain', () => {
    const after = updateProfile(emptyProfile('p'), draft({ gameType: 'FAMILY_GROVE', completionRate: 0.9 }))
    expect(after.scoring!.AFFECTIVE!.level).toBe(60)
    expect(after.scoring!.AFFECTIVE!.raws).toEqual([90])
  })

  it('a profile saved before the engine keeps its levels and starts its history fresh', () => {
    const legacy: CognitiveProfile = {
      ...emptyProfile('p'),
      domainScores: { language: 0.6, visualSemantic: 0.6, motor: 0.6, affective: 0.7, temporal: 0.6, executiveFunction: 0.6 },
    }
    const after = updateProfile(legacy, draft({ domainReadings: { motor: { score: 1, confidence: 1 } } }))
    expect(after.domainScores.motor).toBe(0.7)
    expect(after.scoring!.AFFECTIVE!.level).toBe(70)
  })

  it('does not mutate the profile it was given', () => {
    const before = emptyProfile('p')
    const snapshot = JSON.stringify(before)
    updateProfile(before, draft({ domainReadings: { motor: { score: 1, confidence: 1 } } }))
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
