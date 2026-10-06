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

import type {
  DomainReadings,
  MoodKey,
  SessionResultDraft,
} from "../../../lib/types";

/** An abandoned visit is signal-poor: every reading counts for 40% as much. */
const ABANDON_DAMP = 0.4;

/**
 * The report's per-domain readings, as Smaran readings. Domains the pond did
 * not measure (always `language`) are left out rather than sent as null, and
 * abandonment is folded into confidence — the EMA then does the rest.
 */
export function frogReadings(report: FrogSessionReport): DomainReadings {
  const damp = report.abandoned ? ABANDON_DAMP : 1;
  const out: DomainReadings = {};
  for (const d of COG_DOMAINS as CogDomain[]) {
    const reading = report.domains[d];
    if (reading.score === null || reading.confidence <= 0) continue;
    out[d] = { score: reading.score, confidence: reading.confidence * damp };
  }
  return out;
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
    domainReadings: frogReadings(report),
    metrics: { ...report.raw, abandoned: report.abandoned, highlights: report.highlights },
  };
}
