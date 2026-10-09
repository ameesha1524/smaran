// Bridge from a Lotus Frog session report into Smaran's session model.
//
// The frog game is self-contained (per the design), so this file is the ONLY
// place that knows about Smaran's shapes.
//
// The pond does not update the profile itself. It turns its report into the
// same thing every other game produces — domain readings on a session draft —
// and completeSession() folds those in with the one confidence-weighted EMA in
// lib/cognitiveMap.ts. On the server, SessionService applies the same readings
// through CognitiveMap.java, so the device and the server agree about a pond
// visit exactly as they do about a Duck Roll Call round.

import type { CogDomain } from "./domains";
import { COG_DOMAINS } from "./domains";
import type { FrogSessionReport } from "./report";

import type { MoodKey, SessionResultDraft } from "../../../lib/types";
import { frogContributions, type FrogReading } from "../../modules/lotusFrog";

/** An abandoned visit is signal-poor: every reading counts for 40% as much. */
const ABANDON_DAMP = 0.4;

/**
 * The report's per-domain readings, as the pond made them. Domains the pond did
 * not measure (always `language`) come through with no score and are dropped, and
 * abandonment is folded into confidence — the engine's EMA then does the rest.
 */
export function frogReadings(report: FrogSessionReport): FrogReading[] {
  const damp = report.abandoned ? ABANDON_DAMP : 1;
  return (COG_DOMAINS as CogDomain[]).map((d) => {
    const reading = report.domains[d];
    return { domain: d, score: reading.score, confidence: reading.confidence * damp };
  });
}

/**
 * Shape the report for Smaran's completeSession().
 *
 * `difficultyTier` is fixed at 1: the pond has no tiers, it just flourishes,
 * and a stable value keeps frog visits from perturbing Smaran's tier logic.
 * `metrics` carries the raw behavioural breakdown and the neutral highlights,
 * for the caregiver view — never the patient's.
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
    completed: !report.abandoned,
    abandoned: report.abandoned,
    // The pond's own raw behavioural breakdown, kept as the session's trial record; never interpreted downstream.
    trials: [{ ...report.raw, highlights: report.highlights }],
    // The pond scored itself. Sent as it scored, and flagged so the server never scores it again.
    contributions: frogContributions(frogReadings(report), report.abandoned),
  };
}
