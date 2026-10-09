import { describe, expect, it } from 'vitest'
import { emptyProfile } from './cognitiveProfile'
import { processSession, UnknownGameError } from './sessionPipeline'
import { SESSION_ENVELOPE_FIELDS } from './scoring/types'
import type { SessionResultDraft } from './types'

const START = Date.parse('2026-10-06T04:30:00Z')

const draft = (over: Partial<SessionResultDraft>): SessionResultDraft => ({
  gameType: 'DUCK_ROLL_CALL',
  startedAt: START,
  durationMs: 240_000,
  completionRate: 0.9,
  difficultyTier: 1,
  cognitiveLoadScore: 0.2,
  moodAtStart: 'QUIET',
  trials: [
    { spanLength: 3, flashDurationMs: 2000, correctFirstAttempt: true, attempts: 1, firstErrorAtPosition: null, timeToFirstTapMs: 1800, completedRound: true },
    { spanLength: 3, flashDurationMs: 2000, correctFirstAttempt: true, attempts: 1, firstErrorAtPosition: null, timeToFirstTapMs: 1500, completedRound: true },
  ],
  ...over,
})

describe('a finished game becomes an envelope and one change to the profile', () => {
  it('moves each target the game spoke to exactly once, and no other', () => {
    const before = emptyProfile('p')
    const out = processSession('p', before, draft({}))
    const touched = Object.entries(out.profile.scoring!)
      .filter(([, t]) => t!.observations > 0)
      .map(([k, t]) => [k, t!.observations])
    expect(touched.sort()).toEqual([['EXECUTIVE', 1], ['VISUAL_SEMANTIC', 1], ['WORKING_MEMORY_SPAN', 1]].sort())
  })

  it('does not change the profile it was given', () => {
    const before = emptyProfile('p')
    const snapshot = JSON.stringify(before)
    processSession('p', before, draft({}))
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('sends the same contributions the profile was moved by', () => {
    const out = processSession('p', emptyProfile('p'), draft({}))
    const executive = out.envelope.contributions.find((c) => c.target === 'EXECUTIVE')!
    expect(out.profile.scoring!.EXECUTIVE!.raws).toEqual([executive.raw])
  })

  it('builds an envelope with every field the server expects, filled from the game', () => {
    const { envelope } = processSession('patient-1', emptyProfile('patient-1'), draft({ completed: true, difficultyParams: { span: 3 } }))
    for (const field of SESSION_ENVELOPE_FIELDS) {
      if (field === 'markers' || field === 'precomputedReading') continue
      expect(envelope, field).toHaveProperty(field)
    }
    expect(envelope.patientId).toBe('patient-1')
    expect(envelope.gameId).toBe('duck-roll-call')
    expect(envelope.startedAt).toBe('2026-10-06T04:30:00.000Z')
    expect(envelope.clientSessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(envelope.hourOfDay).toBe(new Date(START).getHours())
    expect(envelope.completed).toBe(true)
    expect(envelope.difficulty).toEqual({ tier: 1, params: { span: 3 } })
    expect(envelope.trials).toHaveLength(2)
    expect(envelope.engineVersion).toBe('1.0.0')
    expect(envelope.precomputedReading).toBeUndefined()
  })

  it('every sitting gets its own client id', () => {
    const a = processSession('p', emptyProfile('p'), draft({}))
    const b = processSession('p', emptyProfile('p'), draft({}))
    expect(a.envelope.clientSessionId).not.toBe(b.envelope.clientSessionId)
  })

  it('carries the marker the game measured', () => {
    const rounds = [3, 3, 4, 4].map((n) => ({
      spanLength: n, flashDurationMs: 2000, correctFirstAttempt: true, attempts: 1, firstErrorAtPosition: null, timeToFirstTapMs: null, completedRound: true,
    }))
    expect(processSession('p', emptyProfile('p'), draft({ trials: rounds })).envelope.markers).toEqual({ workingMemorySpan: 4 })
  })

  it('a game that scores itself is sent as it scored, once, and flagged so the server never re-scores it', () => {
    const out = processSession(
      'p',
      emptyProfile('p'),
      draft({
        gameType: 'LOTUS_FROG',
        trials: [{ some: 'report' }],
        contributions: [
          { target: 'MOTOR', raw: 72, confidence: 0.8, because: 'pond' },
          { target: 'TEMPORAL', raw: 61, confidence: 0.4, because: 'pond' },
          // The pond does not read language; the server would refuse the whole session for it.
          { target: 'LANGUAGE', raw: 90, confidence: 1, because: 'stray' },
        ],
      }),
    )
    expect(out.envelope.precomputedReading).toBe(true)
    expect(out.envelope.contributions.map((c) => [c.target, c.raw])).toEqual([['MOTOR', 72], ['TEMPORAL', 61]])
    expect(out.profile.scoring!.MOTOR!.observations).toBe(1)
    expect(out.profile.scoring!.LANGUAGE!.observations).toBe(0)
  })

  it('a game with no trials is read from how much she did, at low confidence, and says so', () => {
    const out = processSession('p', emptyProfile('p'), draft({ gameType: 'KOI_ARE_JUMPING', trials: undefined, completionRate: 0.5 }))
    expect(out.contributions).toHaveLength(1)
    expect(out.contributions[0]).toMatchObject({ target: 'MOTOR', raw: 50, confidence: 0.3 })
    expect(out.contributions[0].because).toMatch(/no round-by-round record/)
  })

  it('completed defaults from how much she did, and abandoned is carried', () => {
    expect(processSession('p', emptyProfile('p'), draft({ completionRate: 1 })).envelope.completed).toBe(true)
    const left = processSession('p', emptyProfile('p'), draft({ completionRate: 0.4, abandoned: true })).envelope
    expect(left.completed).toBe(false)
    expect(left.abandoned).toBe(true)
  })

  it('refuses a game nobody registered', () => {
    expect(() => processSession('p', emptyProfile('p'), draft({ gameType: 'NOT_A_GAME' as never }))).toThrow(UnknownGameError)
  })
})
