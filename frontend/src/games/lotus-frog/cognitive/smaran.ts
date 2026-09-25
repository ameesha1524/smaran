// Bridge from a Lotus Frog session report into Smaran's cognitive profile.
//
// The frog game is self-contained (per the design), so this file is the ONLY
// place that knows about Smaran's shapes. Inside Smaran it imports the real
// types from `frontend/src/lib/types`.
//
// It does two jobs:
//   · applyFrogReport — fold the five-domain reading into an existing profile
//     with a confidence-weighted EMA (a thin, low-confidence reading barely
//     nudges; a rich one moves it like a normal Smaran session would);
//   · toSessionDraft — shape the report as the SessionResultDraft that Smaran's
//     completeSession() consumes, so a frog visit waters the garden and counts
//     towards sessionCount like any other session.

import type { CogDomain } from "./domains";
import { COG_DOMAINS } from "./domains";
import type { FrogSessionReport } from "./report";

// ── Smaran's own types (the game now lives inside the Smaran frontend) ─────

import type {
  CognitiveProfile,
  DomainScores,
  MoodKey,
  SessionResultDraft,
} from "../../../lib/types";

// ── The EMA blend ────────────────────────────────────────────────────────────

/**
 * Smaran's own updateProfile moves a single domain by `prior·0.75 + new·0.25`.
 * We match that ceiling — a fully-confident frog reading moves a domain by the
 * same 0.25 — but scale the step by the reading's confidence, so a short or
 * distracted visit changes the profile only a little. `language` is never
 * touched (the pond doesn't exercise it, so its reading is always null).
 *
 * @param baseAlpha the maximum weight a full-confidence reading gets (default
 *                  0.25, to sit exactly alongside Smaran's existing sessions).
 */
export function applyFrogReport(
  profile: CognitiveProfile,
  report: FrogSessionReport,
  baseAlpha = 0.25,
): CognitiveProfile {
  // An abandoned visit is signal-poor; let it nudge only very gently.
  const abandonDamp = report.abandoned ? 0.4 : 1;

  const next: DomainScores = { ...profile.domainScores };
  for (const d of COG_DOMAINS as CogDomain[]) {
    const reading = report.domains[d];
    if (reading.score === null || reading.confidence <= 0) continue; // e.g. language
    const alpha = baseAlpha * reading.confidence * abandonDamp;
    const prior = next[d];
    next[d] = round(prior * (1 - alpha) + reading.score * alpha);
  }

  return {
    ...profile,
    domainScores: next,
    updatedAt: report.endedAt,
  };
}

/**
 * Shape the report for Smaran's completeSession().
 *
 * `difficultyTier` is fixed at 1: the pond has no tiers, it just flourishes,
 * and a stable value keeps frog visits from perturbing Smaran's tier logic.
 *
 * Note that completeSession() will NOT re-derive domain scores from this draft
 * — updateProfile() deliberately returns early for LOTUS_FROG, because
 * applyFrogReport above has already folded in a far richer four-domain reading.
 * This draft exists to water the garden, advance sessionCount, and give the
 * session history a row.
 */
export function toSessionDraft(
  report: FrogSessionReport,
  moodAtStart: MoodKey,
): SessionResultDraft {
  return {
    gameType: "LOTUS_FROG",
    startedAt: Date.parse(report.startedAt),
    durationMs: report.durationMs,
    completionRate: report.completionRate,
    difficultyTier: 1,
    cognitiveLoadScore: report.cognitiveLoadScore,
    moodAtStart,
  };
}

function round(n: number): number {
  return Number(n.toFixed(3));
}
