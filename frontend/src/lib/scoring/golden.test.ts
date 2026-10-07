import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applySession } from './engine'
import { buildGolden, type GoldenFile } from './golden'
import {
  ALERT_RULES,
  DEFAULT_CONFIG,
  DOMAIN_IDS,
  ENGINE_VERSION,
  SESSION_ENVELOPE_FIELDS,
  STATUSES,
  SUB_SIGNAL_IDS,
  type Reading,
  type ScoringState,
  type SessionEnvelope,
} from './types'

const file = fileURLToPath(new URL('../../../../golden-vectors.json', import.meta.url))
const golden = JSON.parse(readFileSync(file, 'utf8')) as GoldenFile

const NUMERIC = ['raw', 'confidence', 'level', 'baseline', 'sd', 'velocity', 'domainConfidence'] as const

describe('golden-vectors.json', () => {
  it('is exactly what this engine generates (run `npm run golden` if the rules changed on purpose)', () => {
    // Through JSON so both sides are plain data with the same number formatting.
    expect(golden).toEqual(JSON.parse(JSON.stringify(buildGolden())))
  })

  it('has cases', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(12)
  })

  for (const testCase of golden.cases) {
    it(`replays: ${testCase.name}`, () => {
      const config = { ...golden.config, ...testCase.config }
      let state: ScoringState = testCase.initial
      const readings: Reading[] = []
      for (const contribution of testCase.contributions) {
        const out = applySession(state, [contribution], config)
        state = out.state
        readings.push(...out.readings)
      }
      expect(readings).toHaveLength(testCase.expected.length)
      readings.forEach((r, i) => {
        const want = testCase.expected[i]
        expect(r.target).toBe(want.target)
        expect(r.status).toBe(want.status)
        expect(r.alert).toBe(want.alert)
        for (const key of NUMERIC) expect(r[key]).toBeCloseTo(want[key], 9)
      })
      expect(state).toEqual(testCase.finalState)
    })
  }
})

describe('the contract', () => {
  it('lists the same ids and names as the file', () => {
    expect(golden.engineVersion).toBe(ENGINE_VERSION)
    expect(golden.config).toEqual(DEFAULT_CONFIG)
    expect(golden.contract.domains).toEqual([...DOMAIN_IDS])
    expect(golden.contract.subSignals).toEqual([...SUB_SIGNAL_IDS])
    expect(golden.contract.statuses).toEqual([...STATUSES])
    expect(golden.contract.alertRules).toEqual([...ALERT_RULES])
    expect(golden.contract.sessionEnvelopeFields).toEqual([...SESSION_ENVELOPE_FIELDS])
  })

  it('the sample envelope carries every field and no others', () => {
    const sample: SessionEnvelope = golden.contract.sampleEnvelope
    expect(Object.keys(sample).sort()).toEqual([...SESSION_ENVELOPE_FIELDS].sort())
  })
})
