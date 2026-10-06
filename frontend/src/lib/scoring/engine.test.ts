import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applySession, applyToTarget, initialTargetState, replay, sampleSd, statusFor } from './engine'
import { contributionsFromReadings, domainScoresFrom, stateFromDomainScores } from './legacy'
import { mergeMarkers, workingMemorySpan } from './markers'
import { DEFAULT_CONFIG, TARGET_IDS, type ScoringState, type TargetId } from './types'

const c = (target: TargetId, raw: number, confidence = 1) => ({ target, raw, confidence })

describe('the EMA', () => {
  it('starts at 50 and moves a quarter of the way at full confidence', () => {
    const r = applyToTarget(undefined, c('MOTOR', 100))!
    expect(r.state.level).toBe(62.5)
    expect(r.state.observations).toBe(1)
  })

  it('moves in proportion to confidence', () => {
    expect(applyToTarget(undefined, c('MOTOR', 100, 0.5))!.state.level).toBe(56.25)
  })

  it('leaves untouched targets exactly as they were', () => {
    const before: ScoringState = { LANGUAGE: { ...initialTargetState(), level: 83 } }
    const after = applySession(before, [c('MOTOR', 10)]).state
    expect(after.LANGUAGE).toBe(before.LANGUAGE)
  })

  it('does not mutate its input', () => {
    const before: ScoringState = { MOTOR: { ...initialTargetState(), raws: [60, 61] } }
    const snapshot = JSON.stringify(before)
    applySession(before, [c('MOTOR', 10)])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('what the engine refuses', () => {
  it('skips unknown targets, non-finite numbers and zero confidence', () => {
    const out = applySession({}, [
      { target: 'MEMORY' as TargetId, raw: 50, confidence: 1 },
      c('MOTOR', Number.NaN),
      c('MOTOR', 50, 0),
      c('MOTOR', 50, Number.POSITIVE_INFINITY),
    ])
    expect(out.readings).toEqual([])
    expect(out.state).toEqual({})
  })

  it('clamps raw to 0–100 and confidence to 0–1', () => {
    const r = applyToTarget(undefined, c('MOTOR', 140, 2))!
    expect(r.reading.raw).toBe(100)
    expect(r.reading.confidence).toBe(1)
  })
})

describe('baseline, SD and velocity', () => {
  it('uses the level as baseline until there are three prior raws', () => {
    let s: ScoringState = {}
    const seen: number[] = []
    for (const raw of [62, 58, 65, 60]) {
      const out = applySession(s, [c('TEMPORAL', raw)])
      seen.push(out.readings[0].baseline)
      s = out.state
    }
    expect(seen[0]).toBe(50)
    expect(seen[3]).toBeCloseTo((62 + 58 + 65) / 3, 12)
  })

  it('compares a raw against the raws before it, never against itself', () => {
    const state = replay([62, 58, 65, 60, 57].map((raw) => [c('TEMPORAL', raw)]))
    const r = applyToTarget(state.TEMPORAL, c('TEMPORAL', 10))!
    expect(r.reading.baseline).toBeCloseTo((62 + 58 + 65 + 60 + 57) / 5, 12)
  })

  it('uses the prior SD of 12 until there are five prior raws, then the measured one', () => {
    const four = replay([62, 58, 65, 60].map((raw) => [c('TEMPORAL', raw)]))
    expect(applyToTarget(four.TEMPORAL, c('TEMPORAL', 57))!.reading.sd).toBe(12)
    const five = replay([62, 58, 65, 60, 57].map((raw) => [c('TEMPORAL', raw)]))
    expect(applyToTarget(five.TEMPORAL, c('TEMPORAL', 63))!.reading.sd).toBeCloseTo(sampleSd([62, 58, 65, 60, 57]), 12)
  })

  it('never lets the SD fall below the floor', () => {
    const flat = replay(Array.from({ length: 7 }, () => [c('AFFECTIVE', 70)]))
    const r = applyToTarget(flat.AFFECTIVE, c('AFFECTIVE', 64))!
    expect(r.reading.sd).toBe(DEFAULT_CONFIG.minSd)
    expect(r.reading.velocity).toBe(-2)
  })

  it('keeps only the last 30 raws', () => {
    const state = replay(Array.from({ length: 40 }, (_, i) => [c('MOTOR', i)]))
    expect(state.MOTOR!.raws).toHaveLength(30)
    expect(state.MOTOR!.raws[0]).toBe(10)
    expect(state.MOTOR!.observations).toBe(40)
  })
})

describe('status and gating', () => {
  it('maps velocity to status at the documented thresholds', () => {
    expect(statusFor(-1.5)).toBe('decline')
    expect(statusFor(-1.49)).toBe('watch')
    expect(statusFor(-0.8)).toBe('watch')
    expect(statusFor(-0.79)).toBe('stable')
    expect(statusFor(0.99)).toBe('stable')
    expect(statusFor(1)).toBe('improving')
  })

  it('reports stable, and raises nothing, while domain confidence is under the gate', () => {
    const out = replayReadings([70, 72, 20, 18])
    expect(out.map((r) => r.status)).toEqual(['stable', 'stable', 'stable', 'stable'])
    expect(out.every((r) => r.alert === null)).toBe(true)
    // 4 / 12 = 0.33 is still under 0.35; the fifth observation is the first that can speak.
    expect(out[3].domainConfidence).toBeLessThan(DEFAULT_CONFIG.confidenceGate)
  })
})

describe('alert rules', () => {
  const stableThenLow = [70, 71, 69, 70, 72, 68, 70, 71, 69, 70, 71, 70, 45, 46, 44]

  it('TWO_CONSECUTIVE needs two in a row', () => {
    const out = replayReadings(stableThenLow)
    expect(out[12].status).toBe('decline')
    expect(out[12].alert).toBeNull()
    expect(out[13].alert).toBe('decline')
  })

  it('SINGLE fires on the first', () => {
    const out = replayReadings(stableThenLow, { ...DEFAULT_CONFIG, alertRule: 'SINGLE' })
    expect(out[12].alert).toBe('decline')
  })

  it('one bad day does not alert under TWO_CONSECUTIVE, and the run resets', () => {
    const out = replayReadings([70, 71, 69, 70, 72, 68, 70, 71, 69, 40, 70, 71])
    expect(out[9].status).toBe('decline')
    expect(out.every((r) => r.alert === null)).toBe(true)
  })

  it('CUSUM accumulates a drift and decays when scores recover', () => {
    const config = { ...DEFAULT_CONFIG, alertRule: 'CUSUM' as const }
    const drift = [70, 71, 69, 70, 72, 68, 70, 66, 65, 64, 63, 62, 61]
    const out = replayReadings(drift, config)
    expect(out.some((r) => r.alert !== null)).toBe(true)
    let state = replay(drift.map((raw) => [c('MOTOR', raw)]), config)
    const peak = state.MOTOR!.cusum
    state = replay([[c('MOTOR', 75)], [c('MOTOR', 76)]], config, state)
    expect(state.MOTOR!.cusum).toBeLessThan(peak)
  })
})

describe('the bridge to 0–1 domain scores', () => {
  const scores = { language: 0.6, visualSemantic: 0.6, motor: 0.6, affective: 0.7, temporal: 0.6, executiveFunction: 0.6 }

  it('reproduces the rule the app used before the engine: 0.6 → 0.7', () => {
    const state = stateFromDomainScores(scores)
    const next = applySession(state, contributionsFromReadings({ motor: { score: 1, confidence: 1 } })).state
    expect(domainScoresFrom(next, scores).motor).toBe(0.7)
  })

  it('one session changes the profile exactly once', () => {
    const state = stateFromDomainScores(scores)
    const out = applySession(
      state,
      contributionsFromReadings({ motor: { score: 1, confidence: 1 }, affective: { score: 0.5, confidence: 0.4 } }),
    )
    expect(out.readings).toHaveLength(2)
    expect(out.state.MOTOR!.observations).toBe(1)
    expect(out.state.AFFECTIVE!.observations).toBe(1)
    expect(out.state.LANGUAGE!.observations).toBe(0)
    expect(domainScoresFrom(out.state, scores).language).toBe(0.6)
  })
})

describe('markers', () => {
  it('working-memory span is the largest span that is clean 70% of the time over at least two rounds', () => {
    const rounds = [
      { spanLength: 3, clean: true },
      { spanLength: 3, clean: true },
      { spanLength: 4, clean: true },
      { spanLength: 4, clean: true },
      { spanLength: 4, clean: false },
      { spanLength: 5, clean: true },
      { spanLength: 5, clean: false },
      { spanLength: 6, clean: true },
    ]
    // 4 is clean 2 of 3 (67%): under 70%. 5 is 50%. 6 was tried once.
    expect(workingMemorySpan(rounds)).toBe(3)
    expect(workingMemorySpan([])).toBeUndefined()
  })

  it('a marker the new session did not measure is kept', () => {
    expect(mergeMarkers({ workingMemorySpan: 4 }, { trajectoryPrecisionMs: 120 })).toEqual({
      workingMemorySpan: 4,
      trajectoryPrecisionMs: 120,
    })
  })
})

describe('properties', () => {
  const contribution = fc.record({
    target: fc.constantFrom(...TARGET_IDS),
    raw: fc.double({ min: -50, max: 150, noNaN: true }),
    confidence: fc.double({ min: -1, max: 2, noNaN: true }),
  })

  it('levels stay in 0–100, confidence in 0–1, and nothing is ever NaN', () => {
    fc.assert(
      fc.property(fc.array(contribution, { maxLength: 80 }), (cs) => {
        let state: ScoringState = {}
        for (const one of cs) {
          const out = applySession(state, [one])
          state = out.state
          for (const r of out.readings) {
            expect(r.level).toBeGreaterThanOrEqual(0)
            expect(r.level).toBeLessThanOrEqual(100)
            expect(r.domainConfidence).toBeGreaterThan(0)
            expect(r.domainConfidence).toBeLessThanOrEqual(1)
            expect(Number.isFinite(r.velocity)).toBe(true)
            expect(r.sd).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minSd)
          }
        }
      }),
    )
  })

  it('applying sessions one at a time equals replaying them all', () => {
    fc.assert(
      fc.property(fc.array(fc.array(contribution, { maxLength: 4 }), { maxLength: 30 }), (sessions) => {
        let state: ScoringState = {}
        for (const s of sessions) state = applySession(state, s).state
        expect(state).toEqual(replay(sessions))
      }),
    )
  })

  it('targets do not interfere: interleaving two targets equals scoring each alone', () => {
    const raws = fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { maxLength: 30 })
    fc.assert(
      fc.property(raws, raws, (a, b) => {
        const mixed: ReturnType<typeof c>[][] = []
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          const session = []
          if (i < a.length) session.push(c('MOTOR', a[i]))
          if (i < b.length) session.push(c('LANGUAGE', b[i]))
          mixed.push(session)
        }
        const together = replay(mixed)
        expect(together.MOTOR).toEqual(replay(a.map((raw) => [c('MOTOR', raw)])).MOTOR)
        expect(together.LANGUAGE).toEqual(replay(b.map((raw) => [c('LANGUAGE', raw)])).LANGUAGE)
      }),
    )
  })
})

function replayReadings(raws: number[], config = DEFAULT_CONFIG) {
  let state: ScoringState = {}
  return raws.map((raw) => {
    const out = applySession(state, [c('MOTOR', raw)], config)
    state = out.state
    return out.readings[0]
  })
}
