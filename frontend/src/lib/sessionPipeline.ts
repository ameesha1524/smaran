import { moduleForType, scoreWith } from '../games/registry'
import { updateProfile } from './cognitiveProfile'
import { buildEnvelope, usableContributions } from './scoring/envelope'
import type { ScoreContribution, SessionEnvelope, SessionMarkers } from './scoring/types'
import type { CognitiveProfile, SessionResultDraft } from './types'

/**
 * A finished game, from the game's hands to the queue (docs/MASTER_PROMPT.md, Phase 4):
 *
 *   draft → the game's module scores its trials → contributions
 *         → the scoring engine folds them into the local profile, once
 *         → an envelope is built for the server
 *
 * Pure: no storage, no network, no clock but the draft's own start time. The
 * React context calls it and then does the storing and the sending; tests call it
 * to check, without a browser, that one visit changes the profile exactly once.
 */

export interface Processed {
  envelope: SessionEnvelope
  profile: CognitiveProfile
  contributions: ScoreContribution[]
  markers: SessionMarkers | undefined
}

export class UnknownGameError extends Error {
  constructor(gameType: string) {
    super(`no game module registered for ${gameType}`)
  }
}

/**
 * A game with no trial-level record is still read, from how much of the sitting
 * she did, against its one primary domain, at low confidence. The dashboard
 * says so in the contribution's own words. Every game is meant to send trials;
 * this is the net under them, not a way to skip them.
 */
export function completionOnly(domain: string, completionRate: number): ScoreContribution {
  return {
    target: domain as ScoreContribution['target'],
    raw: Math.max(0, Math.min(100, completionRate * 100)),
    confidence: 0.3,
    because: 'This game kept no round-by-round record, so this reads only how much of the sitting she did.',
  }
}

export function processSession(patientId: string, profile: CognitiveProfile, draft: SessionResultDraft): Processed {
  const module = moduleForType(draft.gameType)
  if (!module) throw new UnknownGameError(draft.gameType)

  const hourOfDay = new Date(draft.startedAt).getHours()
  const trials = draft.trials ?? []

  let contributions: ScoreContribution[]
  let markers: SessionMarkers | undefined
  if (draft.contributions) {
    // The game scored itself (the Lotus Frog) and is not scored again.
    contributions = draft.contributions
  } else {
    const scored = scoreWith(module, trials, hourOfDay)
    contributions = scored.contributions
    markers = scored.markers
  }
  contributions = usableContributions(contributions, module.targets)
  if (contributions.length === 0 && module.primaryDomains[0]) {
    contributions = [completionOnly(module.primaryDomains[0], draft.completionRate)]
  }

  const completed = draft.completed ?? draft.completionRate >= 0.95
  const envelope = buildEnvelope({
    patientId,
    module,
    startedAt: draft.startedAt,
    durationMs: draft.durationMs,
    completed,
    abandoned: draft.abandoned ?? false,
    moodAtStart: draft.moodAtStart,
    difficulty: { tier: draft.difficultyTier, params: draft.difficultyParams },
    trials,
    contributions,
    markers,
  })

  return { envelope, profile: updateProfile(profile, draft, envelope.contributions), contributions: envelope.contributions, markers }
}
