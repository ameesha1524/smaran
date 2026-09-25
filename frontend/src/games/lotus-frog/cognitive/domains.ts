// The cognitive domains this game reads.
//
// These five names are deliberately identical to Smaran's `DomainScores`
// (frontend/src/lib/types.ts and CognitiveProfile.java) so a report from the
// Lotus Frog game drops straight into the patient's existing cognitive profile
// with no translation layer. Do not rename them without changing Smaran too.
//
//   language       — spoken/word retrieval. NOT exercised by this game: catching
//                    bugs asks nothing of language, so the frog report leaves
//                    this domain untouched (null) rather than inventing a reading.
//   visualSemantic — selective visual attention, moving-target tracking, and
//                    recognising distinct object kinds across the whole field.
//   motor          — fine motor control and coordination: how cleanly and how
//                    rhythmically she taps.
//   affective      — mood and engagement: sustained active play vs. withdrawal,
//                    and the little bursts of delight (pokes, croaks, water play).
//   temporal       — processing speed: how quickly she spots a target and acts,
//                    and how free of long hesitation that decision is.

export type CogDomain =
  | "language"
  | "visualSemantic"
  | "motor"
  | "affective"
  | "temporal";

export const COG_DOMAINS: CogDomain[] = [
  "language",
  "visualSemantic",
  "motor",
  "affective",
  "temporal",
];

/** A full set of domain scores, 0..1. Mirrors Smaran's DomainScores. */
export type DomainScores = Record<CogDomain, number>;

/**
 * One domain's reading from a single session.
 *  · `score`          — 0..1, or null when the game gathered no evidence for it
 *                       (always the case for `language`).
 *  · `evidenceWeight` — total accumulated weight behind the score; more play and
 *                       more decisive actions raise it.
 *  · `confidence`     — 0..1 derived from evidenceWeight; how much this reading
 *                       should be trusted to move the long-running profile.
 */
export interface DomainReading {
  score: number | null;
  evidenceWeight: number;
  confidence: number;
}
