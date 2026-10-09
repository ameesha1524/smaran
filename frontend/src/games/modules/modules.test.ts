import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { TARGET_IDS } from '../../lib/scoring/types'
import { GAME_MODULES, moduleById } from '../registry'
import { duckMarkers, scoreDuck } from './duckRollCall'
import { frogContributions } from './lotusFrog'
import { scoreGrove } from './familyGrove'
import { scoreKoi } from './koiAreJumping'
import { scoreRituals } from './morningRituals'
import { scoreTale } from './grandmothersTale'

const find = <T extends { target: string }>(cs: T[], target: string): T | undefined => cs.find((c) => c.target === target)

describe('Duck Roll Call', () => {
  const round = (over: object = {}) => ({
    spanLength: 3,
    flashDurationMs: 2000,
    correctFirstAttempt: true,
    attempts: 1,
    firstErrorAtPosition: null,
    timeToFirstTapMs: null,
    completedRound: true,
    ...over,
  })

  it('reads a clean span of 3 at the slow flash as 50, at the confidence floor', () => {
    const cs = scoreDuck([round()])
    expect(find(cs, 'EXECUTIVE')).toMatchObject({ raw: 50, confidence: 0.15 })
    expect(find(cs, 'WORKING_MEMORY_SPAN')).toMatchObject({ raw: 50, confidence: 0.15 })
    expect(find(cs, 'VISUAL_SEMANTIC')).toBeUndefined()
  })

  it('counts a round with wrong taps as the span minus a half, and an unfinished round as the position reached', () => {
    expect(find(scoreDuck([round({ spanLength: 4, correctFirstAttempt: false, attempts: 3 })]), 'EXECUTIVE')!.raw).toBeCloseTo(58.33, 2)
    expect(
      find(scoreDuck([round({ spanLength: 4, correctFirstAttempt: false, completedRound: false, positionReached: 2 })]), 'EXECUTIVE')!.raw,
    ).toBeCloseTo(33.33, 2)
  })

  it('gives a faster flash up to a quarter more, and never more than 100', () => {
    expect(find(scoreDuck([round({ spanLength: 4, flashDurationMs: 1400 })]), 'EXECUTIVE')!.raw).toBeCloseTo((100 * 4 * 1.125) / 6, 1)
    expect(find(scoreDuck(Array(8).fill(round({ spanLength: 6, flashDurationMs: 800 }))), 'EXECUTIVE')!.raw).toBe(100)
  })

  it('reads retrieval speed weakly: a fifth of the weight of the span reading would be too much, so 0.4 of it', () => {
    const cs = scoreDuck([round({ timeToFirstTapMs: 1000 }), round({ timeToFirstTapMs: 3500 })])
    const speed = find(cs, 'VISUAL_SEMANTIC')!
    expect(speed.raw).toBeCloseTo((100 * (1 + 0.5)) / 2, 1)
    expect(speed.confidence).toBeCloseTo(0.4 * find(cs, 'EXECUTIVE')!.confidence, 3)
  })

  it('says in plain words what it saw', () => {
    const [executive] = scoreDuck([round(), round({ spanLength: 4 })])
    expect(executive.because).toMatch(/Held about 3\.5 ducklings in mind across 2 rounds, 2 of them with no wrong tap\./)
  })

  it('reports the largest span she managed cleanly at least twice', () => {
    const clean = (n: number) => round({ spanLength: n })
    expect(duckMarkers([clean(3), clean(3), clean(4), clean(4), clean(5)])).toEqual({ workingMemorySpan: 4 })
    expect(duckMarkers([clean(3)])).toBeUndefined()
    expect(duckMarkers([])).toBeUndefined()
  })
})

describe('Grandmother’s Tale', () => {
  it('reads language from how directly she reached each right picture, and attention from replays', () => {
    const cs = scoreTale([
      { storyId: 'a', wrongTaps: 0, replays: 0 },
      { storyId: 'b', wrongTaps: 1, replays: 2 },
    ])
    expect(find(cs, 'LANGUAGE')).toMatchObject({ raw: 90, confidence: 0.5 })
    expect(find(cs, 'SUSTAINED_ATTENTION')).toMatchObject({ raw: 85, confidence: 0.3 })
    expect(find(cs, 'SUSTAINED_ATTENTION')!.because).toMatch(/Hearing it twice is not a problem/)
  })

  it('never goes below the floors however many mistakes', () => {
    const cs = scoreTale([{ wrongTaps: 9, replays: 9 }])
    expect(find(cs, 'LANGUAGE')!.raw).toBe(40)
    expect(find(cs, 'SUSTAINED_ATTENTION')!.raw).toBe(40)
  })
})

describe('Family Grove', () => {
  it('reads recognition at full marks for a quick first-time answer, and AFFECTIVE at half the confidence', () => {
    const cs = scoreGrove(Array(5).fill({ memberId: 'm', wrongTaps: 0, latencyMs: 1500 }))
    expect(find(cs, 'VISUAL_SEMANTIC')).toMatchObject({ raw: 100, confidence: 1 })
    expect(find(cs, 'AFFECTIVE')).toMatchObject({ raw: 100, confidence: 0.5 })
  })

  it('takes a little off a slow answer and a lot more off a wrong one', () => {
    expect(find(scoreGrove([{ wrongTaps: 0, latencyMs: 8000 }]), 'VISUAL_SEMANTIC')!.raw).toBe(75)
    expect(find(scoreGrove([{ wrongTaps: 2, latencyMs: 1000 }]), 'VISUAL_SEMANTIC')!.raw).toBe(40)
    expect(find(scoreGrove([{ wrongTaps: 9, latencyMs: 1000 }]), 'VISUAL_SEMANTIC')!.raw).toBe(35)
  })

  it('is honest that recognition is not affect', () => {
    expect(find(scoreGrove([{ wrongTaps: 0 }]), 'AFFECTIVE')!.because).toMatch(/recognition/)
  })
})

describe('Morning Rituals', () => {
  it('reads temporal order from the share of placements that were right, and executive from the extra tries', () => {
    const attempts = [
      { itemId: 'a', slotIndex: 0, correct: true },
      { itemId: 'b', slotIndex: 0, correct: false },
      { itemId: 'b', slotIndex: 1, correct: true },
      { itemId: 'c', slotIndex: 2, correct: true },
    ]
    const cs = scoreRituals(attempts)
    expect(find(cs, 'TEMPORAL')).toMatchObject({ raw: 75 })
    expect(find(cs, 'TEMPORAL')!.confidence).toBeCloseTo(4 / 6, 3)
    expect(find(cs, 'EXECUTIVE')!.raw).toBeCloseTo(100 - 40 * (1 / 3), 1)
  })

  it('has no executive reading when nothing was placed right', () => {
    expect(find(scoreRituals([{ slotIndex: 0, correct: false }]), 'EXECUTIVE')).toBeUndefined()
  })
})

describe('Koi Are Jumping', () => {
  it('reads MOTOR from response rate and how early she answered, and REACTION_SPEED from the speed alone', () => {
    const cs = scoreKoi([
      { wasTapped: true, reactionMs: 500, leapMs: 1000 },
      { wasTapped: false, reactionMs: null, leapMs: 1000 },
    ])
    expect(find(cs, 'MOTOR')!.raw).toBeCloseTo(100 * (0.7 * 0.5 + 0.3 * 0.5), 1)
    expect(find(cs, 'REACTION_SPEED')!.raw).toBe(50)
  })

  it('reads zero, and no speed, when she answered none', () => {
    const cs = scoreKoi([{ wasTapped: false, reactionMs: null, leapMs: 1000 }])
    expect(find(cs, 'MOTOR')!.raw).toBe(0)
    expect(find(cs, 'REACTION_SPEED')).toBeUndefined()
  })
})

describe('Lotus Frog', () => {
  it('passes the pond’s own readings through, as they are, once each, and drops the one it did not measure', () => {
    const cs = frogContributions(
      [
        { domain: 'visualSemantic', score: 0.8, confidence: 0.9 },
        { domain: 'motor', score: 0.7, confidence: 0.8 },
        { domain: 'affective', score: null, confidence: 0.5 },
        { domain: 'language', score: 0.5, confidence: 1 },
      ],
      false,
    )
    expect(cs.map((c) => [c.target, c.raw, c.confidence])).toEqual([
      ['VISUAL_SEMANTIC', 80, 0.9],
      ['MOTOR', 70, 0.8],
    ])
  })

  it('says when an abandoned visit was counted lightly', () => {
    expect(frogContributions([{ domain: 'motor', score: 0.7, confidence: 0.3 }], true)[0].because).toMatch(/left early/)
  })
})

describe('what every module promises, whatever it is given', () => {
  const real = GAME_MODULES.filter((m) => !m.retired && !m.precomputed)

  for (const module of real) {
    it(`${module.id} never throws on junk and only says what it is allowed to say`, () => {
      fc.assert(
        fc.property(fc.array(fc.anything(), { maxLength: 30 }), (trials) => {
          const cs = module.scoreSession(trials, { hourOfDay: 9 })
          const seen = new Set<string>()
          for (const c of cs) {
            expect(module.targets).toContain(c.target)
            expect(TARGET_IDS).toContain(c.target)
            expect(Number.isFinite(c.raw) && c.raw >= 0 && c.raw <= 100).toBe(true)
            expect(Number.isFinite(c.confidence) && c.confidence > 0 && c.confidence <= 1).toBe(true)
            expect(typeof c.because).toBe('string')
            expect(seen.has(c.target)).toBe(false)
            seen.add(c.target)
          }
        }),
        { numRuns: 200 },
      )
    })

    it(`${module.id} scores nothing from nothing`, () => {
      expect(module.scoreSession([], { hourOfDay: 9 })).toEqual([])
    })
  }

  it('the retired Weaver’s Loom scores nothing at all', () => {
    expect(moduleById('weavers-loom')!.scoreSession([{ anything: 1 }], { hourOfDay: 9 })).toEqual([])
  })
})

/* ------------------------------------------------ the shared vectors */

describe('duck-roll-call-vectors.json, written from the rules in Python', () => {
  const file = JSON.parse(readFileSync(new URL('../../../../duck-roll-call-vectors.json', import.meta.url), 'utf-8')) as {
    vectors: { name: string; trials: unknown[]; expected: { target: string; raw: number; confidence: number }[] }[]
  }

  it('has cases', () => {
    expect(file.vectors.length).toBeGreaterThanOrEqual(12)
  })

  for (const v of file.vectors) {
    it(v.name, () => {
      const got = scoreDuck(v.trials)
      expect(got.map((c) => c.target)).toEqual(v.expected.map((e) => e.target))
      got.forEach((c, i) => {
        // The module rounds raw to 2 decimals and confidence to 3.
        expect(Math.abs(c.raw - v.expected[i].raw)).toBeLessThanOrEqual(0.005 + 1e-9)
        expect(Math.abs(c.confidence - v.expected[i].confidence)).toBeLessThanOrEqual(0.0005 + 1e-9)
      })
    })
  }
})

/* ------------------------------------------- the two registries agree */

describe('the device registry and the server’s game-registry.json', () => {
  const server = JSON.parse(
    readFileSync(new URL('../../../../backend/src/main/resources/game-registry.json', import.meta.url), 'utf-8'),
  ) as {
    games: { id: string; gameType: string; title: string; route: string; primaryDomains: string[]; targets: string[]; precomputed: boolean; retired: boolean }[]
  }

  it('list the same games, in the same terms', () => {
    const device = GAME_MODULES.map((m) => ({
      id: m.id,
      gameType: m.gameType,
      title: m.title,
      route: m.route,
      primaryDomains: m.primaryDomains,
      targets: m.targets,
      precomputed: m.precomputed ?? false,
      retired: m.retired ?? false,
    }))
    expect(device).toEqual(server.games)
  })
})
