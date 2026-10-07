/**
 * Golden vectors: fixed inputs and the outputs this engine gives for them.
 *
 * `buildGolden()` is what `npm run golden` writes to golden-vectors.json at the
 * repo root. Three test suites read that file:
 *
 *   TypeScript  rebuilds it and fails if the checked-in file differs
 *   Java        ScoringEngineGoldenTest replays every case
 *   Python      data-science/tests (Phase 5) replays every case
 *
 * The random-looking sequences come from a seeded generator, so the file is
 * the same on every run. The other languages never need the generator: they
 * read the inputs from the file.
 */

import { applySession } from './engine'
import {
  ALERT_RULES,
  DEFAULT_CONFIG,
  DOMAIN_IDS,
  ENGINE_VERSION,
  SESSION_ENVELOPE_FIELDS,
  STATUSES,
  SUB_SIGNAL_IDS,
  type Reading,
  type ScoringConfig,
  type ScoringState,
  type SessionEnvelope,
  type TargetId,
} from './types'

export interface GoldenInput {
  target: TargetId
  raw: number
  confidence: number
}

export interface GoldenCase {
  name: string
  about: string
  /** Overrides on top of the default config. */
  config: Partial<ScoringConfig>
  initial: ScoringState
  /** One contribution per step, applied in order. */
  contributions: GoldenInput[]
  /** One reading per accepted contribution. */
  expected: Reading[]
  finalState: ScoringState
}

export interface GoldenFile {
  engineVersion: string
  note: string
  config: ScoringConfig
  contract: {
    domains: readonly string[]
    subSignals: readonly string[]
    statuses: readonly string[]
    alertRules: readonly string[]
    sessionEnvelopeFields: readonly string[]
    sampleEnvelope: SessionEnvelope
  }
  cases: GoldenCase[]
}

/** mulberry32: a small, well-known seeded generator. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Two decimals keeps the inputs short and exactly representable enough to read. */
const r2 = (n: number) => Math.round(n * 100) / 100

function series(seed: number, n: number, f: (i: number, noise: number) => number, target: TargetId, confidence = 1): GoldenInput[] {
  const next = rng(seed)
  return Array.from({ length: n }, (_, i) => ({
    target,
    raw: r2(Math.max(0, Math.min(100, f(i, (next() - 0.5) * 2)))),
    confidence,
  }))
}

const one = (target: TargetId, raw: number, confidence = 1): GoldenInput => ({ target, raw, confidence })

type CaseSpec = Omit<GoldenCase, 'expected' | 'finalState' | 'config' | 'initial'> & {
  config?: Partial<ScoringConfig>
  initial?: ScoringState
}

const SPECS: CaseSpec[] = [
  {
    name: 'ema-full-confidence',
    about: 'From 50, a raw of 100 at full confidence moves the level a quarter of the way: 62.5.',
    contributions: [one('MOTOR', 100)],
  },
  {
    name: 'ema-half-confidence',
    about: 'Half the confidence, half the step: 56.25.',
    contributions: [one('MOTOR', 100, 0.5)],
  },
  {
    name: 'migrated-profile',
    about: 'A profile saved before the engine: level 60, no history. Matches the old 0.6 → 0.7 rule.',
    initial: { MOTOR: { level: 60, observations: 0, raws: [], runWatch: 0, runDecline: 0, cusum: 0 } },
    contributions: [one('MOTOR', 100), one('MOTOR', 0)],
  },
  {
    name: 'clamped-and-rejected',
    about: 'Out-of-range values are clamped; zero confidence is skipped and produces no reading.',
    contributions: [one('LANGUAGE', 140, 2), one('LANGUAGE', -20, 0.5), one('LANGUAGE', 70, 0)],
  },
  {
    name: 'baseline-and-sd-warmup',
    about: 'Baseline is the level for the first 3, then the trailing mean. SD is 12 for the first 5, then measured.',
    contributions: [62, 58, 65, 60, 57, 63, 61, 40].map((raw) => one('TEMPORAL', raw)),
  },
  {
    name: 'identical-raws-sd-floor',
    about: 'Seven identical scores give a measured SD of 0; the floor of 3 keeps velocity finite.',
    contributions: [...Array.from({ length: 7 }, () => one('AFFECTIVE', 70)), one('AFFECTIVE', 64)],
  },
  {
    name: 'gated-early-drop',
    about: 'A collapse on the third session is still `stable`: domain confidence is 0.25, under the 0.35 gate.',
    contributions: [one('EXECUTIVE', 70), one('EXECUTIVE', 72), one('EXECUTIVE', 20), one('EXECUTIVE', 18)],
  },
  {
    name: 'two-consecutive-decline',
    about: 'Stable around 70, then a sustained fall. The first low reading is `decline` but raises nothing; the second raises the alert.',
    contributions: series(11, 16, (i, e) => (i < 12 ? 70 + 4 * e : 45 + 4 * e), 'EXECUTIVE'),
  },
  {
    name: 'single-rule',
    about: 'The same series under SINGLE: the alert fires one session sooner, and ordinary noise raises a false watch earlier on.',
    config: { alertRule: 'SINGLE' },
    contributions: series(11, 16, (i, e) => (i < 12 ? 70 + 4 * e : 45 + 4 * e), 'EXECUTIVE'),
  },
  {
    name: 'cusum-slow-drift',
    about: 'A slow slide of about 0.9 points a session, under CUSUM: the sum crosses h / 2 (watch), then h (decline).',
    config: { alertRule: 'CUSUM' },
    contributions: series(23, 30, (i, e) => 72 - 0.9 * Math.max(0, i - 8) + 3 * e, 'LANGUAGE'),
  },
  {
    name: 'one-bad-day',
    about: 'A single poor session in a stable run: `decline` for that reading, no alert, and the run resets.',
    contributions: series(5, 14, (i, e) => (i === 9 ? 38 : 68 + 3 * e), 'MOTOR'),
  },
  {
    name: 'improving',
    about: 'A step up registers as `improving` and never alerts.',
    contributions: series(31, 14, (i, e) => (i < 9 ? 50 + 3 * e : 68 + 3 * e), 'VISUAL_SEMANTIC'),
  },
  {
    name: 'window-rollover',
    about: 'Forty sessions: only the last 30 raws are kept, and the baseline follows them.',
    contributions: series(77, 40, (i, e) => 60 + 0.4 * i + 5 * e, 'TEMPORAL', 0.8),
  },
  {
    name: 'gating-off',
    about: 'With the gate at 0, the early collapse in `gated-early-drop` is reported and alerts.',
    config: { confidenceGate: 0 },
    contributions: [one('EXECUTIVE', 70), one('EXECUTIVE', 72), one('EXECUTIVE', 20), one('EXECUTIVE', 18)],
  },
  {
    name: 'many-targets',
    about: 'One visit touching several domains and a sub-signal: each keeps its own state.',
    contributions: [
      one('VISUAL_SEMANTIC', 82, 0.9),
      one('MOTOR', 64, 0.7),
      one('AFFECTIVE', 71, 0.36),
      one('WORKING_MEMORY_SPAN', 55, 0.5),
      one('VISUAL_SEMANTIC', 78, 0.9),
      one('MOTOR', 60, 0.28),
    ],
  },
  {
    name: 'low-confidence-sessions',
    about: 'Abandoned visits at 0.1 confidence barely move the level but still count as observations.',
    contributions: series(41, 10, (_, e) => 30 + 5 * e, 'AFFECTIVE', 0.1),
  },
]

const SAMPLE_ENVELOPE: SessionEnvelope = {
  clientSessionId: '3f0c2a5e-8b1d-4c7a-9e2f-5a6b7c8d9e0f',
  patientId: 'demo-patient',
  gameId: 'duck-roll-call',
  startedAt: '2026-10-06T04:30:00.000Z',
  durationMs: 184000,
  completed: true,
  abandoned: false,
  hourOfDay: 10,
  moodAtStart: 'QUIET',
  difficulty: { tier: 2, params: { span: 4, flashMs: 2000 } },
  trials: [{ spanLength: 4, flashDurationMs: 2000, correctFirstAttempt: true, attempts: 1 }],
  contributions: [
    { target: 'EXECUTIVE', raw: 62.5, confidence: 0.5, because: 'Held four numbers in order on the first try.' },
    { target: 'WORKING_MEMORY_SPAN', raw: 62.5, confidence: 0.5, because: 'Span of four.' },
  ],
  markers: { workingMemorySpan: 4 },
  precomputedReading: false,
  engineVersion: ENGINE_VERSION,
}

export function runCase(spec: CaseSpec): GoldenCase {
  const config = { ...DEFAULT_CONFIG, ...(spec.config ?? {}) }
  let state: ScoringState = spec.initial ?? {}
  const expected: Reading[] = []
  for (const c of spec.contributions) {
    const result = applySession(state, [c], config)
    state = result.state
    expected.push(...result.readings)
  }
  return {
    name: spec.name,
    about: spec.about,
    config: spec.config ?? {},
    initial: spec.initial ?? {},
    contributions: spec.contributions,
    expected,
    finalState: state,
  }
}

export function buildGolden(): GoldenFile {
  return {
    engineVersion: ENGINE_VERSION,
    note:
      'Generated by frontend/src/lib/scoring/golden.ts (npm run golden). Do not edit by hand. ' +
      'Inputs are synthetic and exist to pin arithmetic, not to resemble a patient.',
    config: DEFAULT_CONFIG,
    contract: {
      domains: DOMAIN_IDS,
      subSignals: SUB_SIGNAL_IDS,
      statuses: STATUSES,
      alertRules: ALERT_RULES,
      sessionEnvelopeFields: SESSION_ENVELOPE_FIELDS,
      sampleEnvelope: SAMPLE_ENVELOPE,
    },
    cases: SPECS.map(runCase),
  }
}
