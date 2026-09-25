// The batch report a single Lotus Frog session produces at the end.
//
// It carries two things:
//   1. `domains` — the cognitive reading, shaped to drop into Smaran's profile.
//   2. `raw` — the full behavioural breakdown behind that reading, for the
//      caregiver dashboard (and for anyone auditing why a domain moved).
//
// Nothing here is shown to the patient. Ever.

import type { CogDomain, DomainReading } from "./domains";

/** The raw behavioural signals gathered across one session. */
export interface RawSignals {
  catches: number;
  misTaps: number;
  waterPlays: number;
  pokes: number;
  bigCroaks: number;
  hops: number;
  dozes: number;

  /** Distinct bug kinds caught, and the per-kind tally. */
  distinctKinds: number;
  kindCounts: Record<string, number>;

  /** Time (ms) from a bug first appearing to it being tapped, per catch. */
  decisionLatenciesMs: number[];
  medianDecisionMs: number | null;
  /** Catches whose decision was slower than the hesitation threshold. */
  hesitations: number;

  /** Distance (internal px) from each catch-tap to the bug centre. */
  tapOffsetsPx: number[];
  meanTapOffsetPx: number | null;

  activeSeconds: number;
  idleSeconds: number;
  /** activeSeconds / (activeSeconds + idleSeconds), 0..1. */
  engagementRatio: number;
}

export interface FrogSessionReport {
  /** Matches a Smaran GameType slot; the frog game registers as this. */
  gameType: "LOTUS_FROG";

  startedAt: string; // ISO
  endedAt: string; // ISO
  durationMs: number;

  /** The five-domain reading. `language` is always null (never exercised). */
  domains: Record<CogDomain, DomainReading>;

  /** 0..1 "how well it went overall" — mean of measured domain scores. Feeds
   *  Smaran's GameSession.completionRate. 0.5 when nothing was measured. */
  completionRate: number;

  /** 0..1 strain estimate for Smaran's GameSession.cognitiveLoadScore
   *  (higher = more hesitation / less engagement). */
  cognitiveLoadScore: number;

  /** True when the session was too thin (few catches, mostly idle) to trust. */
  abandoned: boolean;

  raw: RawSignals;

  /** Short, neutral, human-readable notes for the caregiver view. */
  highlights: string[];
}
