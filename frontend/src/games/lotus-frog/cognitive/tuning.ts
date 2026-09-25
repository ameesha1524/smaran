// ─────────────────────────────────────────────────────────────────────────────
// THE COGNITIVE MODEL — every action, and exactly how it moves the profile.
// ─────────────────────────────────────────────────────────────────────────────
//
// This file is the single source of truth for "how does what she does at the
// pond map onto her cognitive profile." It is intentionally declarative and
// heavily commented so a caregiver-facing clinician (or a future you) can read
// the model without reading the tracker.
//
// HOW THE SCORING WORKS
// ---------------------
// Each action contributes *evidence* to one or more domains. A piece of
// evidence is a pair:
//
//     weight  — how much this action counts toward that domain (its say)
//     value   — the 0..1 performance reading it carries (how well it went)
//
// A domain's session score is the weight-weighted average of all its evidence:
//
//     score(domain) = Σ(weightᵢ · valueᵢ) / Σ(weightᵢ)
//
// So a fast, clean catch pushes `temporal` toward 1; a long hesitation before a
// catch pushes it toward 0; dozing off drags `affective` down hard. A domain
// with no evidence scores `null` — the game refuses to guess (this is always
// true of `language`, which the pond never exercises).
//
// Some values are constants (a poke is always a warm, engaged act). Others are
// computed live from timing/precision by the value-functions at the bottom.
//
// WHY THESE NUMBERS
// -----------------
// In this game bugs never escape and a click on a bug always lands a catch —
// so "accuracy" is not the discriminating signal. What genuinely varies with a
// dementia patient's state, and what this model therefore leans on, is:
//   · decision latency  (how long a bug drifts before she notices & acts)  → temporal
//   · tap precision      (how close her tap lands to the target)            → motor
//   · mis-taps           (reaching for a bug and missing it)                → motor/attention
//   · engagement         (active play vs. dozing off)                       → affective
//   · playful bursts     (pokes, double-croaks, water play)                 → affective
//   · kind breadth       (does she work the whole visual field & all kinds) → visualSemantic
//
// Weights are generous and forgiving by design — this is a calm companion for
// an elderly patient, not a test. One slow day should nudge, never rewrite; the
// long-running profile blends readings with an EMA on top of this (see smaran.ts).

import type { CogDomain } from "./domains";

// ── Normalisation constants ─────────────────────────────────────────────────
// Tuned for elderly, non-timed play. Comfortable at the fast end, patient at
// the slow end.

/** A decision at or under this (ms, from bug appearing to tap) reads as fully quick. */
export const FAST_DECISION_MS = 1200;
/** A decision at or over this (ms) reads as fully slow (value 0 for speed). */
export const SLOW_DECISION_MS = 9000;
/** A decision slower than this (ms) is additionally counted as a hesitation. */
export const HESITATION_MS = 6000;

/** A tap landing within this many internal px of the target centre is fully precise. */
export const PRECISE_PX = 6;
/** A tap this far or further from centre reads as fully imprecise (value 0). */
export const LOOSE_PX = 40;

/** A water/empty tap within this many px of a bug counts as a *targeting miss*
 *  (she was reaching for that bug); further out it is calm water play. */
export const MIS_TAP_RADIUS_PX = 34;

/** Seconds of no pointer movement before the frog dozes — mirrors Frog.SLEEP_AFTER. */
export const DOZE_AFTER_S = 24;
/** How often (s) an attentive-but-still "watching" tick is credited while present. */
export const IDLE_WATCH_EVERY_S = 5;

/** Below this many catches, a session is treated as abandoned / too thin to trust. */
export const MIN_MEANINGFUL_CATCHES = 2;

/** Evidence weight at which a domain reading is considered fully confident.
 *  Confidence = clamp01(evidenceWeight / CONFIDENCE_FULL_WEIGHT). */
export const CONFIDENCE_FULL_WEIGHT = 6;

// ── The action → domain impact table ────────────────────────────────────────
//
// Read this as: "when <action> happens, add this evidence to each listed
// domain." `value` is either a fixed number, or the string name of a
// value-function resolved live (see VALUE_FNS below).

export type ValueSpec =
  | number
  | { fn: "decision"; base: number; span: number } // base + span·decisionValue(latency)
  | { fn: "precision" }                              // precisionValue(offsetPx)
  | { fn: "decisionRaw" };                           // decisionValue(latency), no base

export type ActionImpact = Partial<Record<CogDomain, { weight: number; value: ValueSpec }>>;

export type CogActionKind =
  | "catch" // clicked a bug and it was eaten — the richest positive event
  | "kindDiscovered" // first catch of a given bug-kind this session
  | "misTapNear" // tap hit nothing, but was reaching for a nearby bug (a miss)
  | "waterPlay" // calm tap on open water, away from any bug
  | "frogPoke" // single tap on the frog
  | "bigCroak" // double-tap on the frog
  | "hop" // frog hopped a pad to reach a distant, deliberately-chosen target
  | "idleWatch" // present and attentive but not acting (periodic credit)
  | "doze"; // dozed off after a long undisturbed spell — withdrawal

export const ACTION_MODEL: Record<CogActionKind, ActionImpact> = {
  // A successful catch is the anchor event. It says: she spotted a moving
  // target among others (visualSemantic), decided and acted quickly (temporal),
  // and tapped it cleanly (motor) — with a little glow of reward (affective).
  catch: {
    visualSemantic: { weight: 1.0, value: { fn: "decision", base: 0.6, span: 0.4 } },
    temporal: { weight: 1.0, value: { fn: "decisionRaw" } },
    motor: { weight: 0.9, value: { fn: "precision" } },
    affective: { weight: 0.3, value: 0.8 },
  },

  // The first time she catches each *kind* of bug this session — evidence she is
  // working the whole visual field and telling distinct objects apart, not
  // fixating on one corner or one shape.
  kindDiscovered: {
    visualSemantic: { weight: 0.6, value: 0.9 },
  },

  // A tap that caught nothing but was clearly aimed at a bug nearby: a targeting
  // miss. Gentle negative evidence for motor precision and selective attention.
  misTapNear: {
    motor: { weight: 0.8, value: 0.15 },
    visualSemantic: { weight: 0.5, value: 0.25 },
  },

  // Tapping open water, away from bugs — not an error. Ripples, a fish may jump.
  // Calm, exploratory, self-soothing engagement.
  waterPlay: {
    affective: { weight: 0.4, value: 0.75 },
  },

  // Poking the frog: a deliberate, aimed, connected little act.
  frogPoke: {
    affective: { weight: 0.5, value: 0.8 },
    motor: { weight: 0.3, value: { fn: "precision" } },
  },

  // Double-tapping the frog for a big croak: delighted, and a small feat of
  // timed coordination (two taps in quick succession).
  bigCroak: {
    affective: { weight: 0.5, value: 0.85 },
    motor: { weight: 0.4, value: 0.7 },
    temporal: { weight: 0.2, value: 0.7 },
  },

  // Choosing a far-off bug so the frog hops pad-to-pad to reach it — attention
  // reaching across the whole field, and a spatial pursuit carried through.
  hop: {
    motor: { weight: 0.3, value: 0.7 },
    visualSemantic: { weight: 0.2, value: 0.7 },
  },

  // A quiet baseline: present, eyes on the pond, not acting. A little calm
  // engagement, small enough not to drown the discrete actions.
  idleWatch: {
    affective: { weight: 0.15, value: 0.6 },
  },

  // Dozing off after a long undisturbed spell — the clearest withdrawal signal
  // the pond offers. Weighs heavily on affect, lightly on processing (dead time).
  doze: {
    affective: { weight: 0.9, value: 0.2 },
    temporal: { weight: 0.2, value: 0.3 },
  },
};

// ── Value functions ─────────────────────────────────────────────────────────

/** 1 when the decision was quick (≤ FAST), 0 when slow (≥ SLOW), linear between. */
export function decisionValue(latencyMs: number): number {
  const span = SLOW_DECISION_MS - FAST_DECISION_MS;
  return clamp01((SLOW_DECISION_MS - latencyMs) / span);
}

/** 1 for a tap dead on centre (≤ PRECISE_PX), 0 for a loose one (≥ LOOSE_PX). */
export function precisionValue(offsetPx: number): number {
  const span = LOOSE_PX - PRECISE_PX;
  return clamp01((LOOSE_PX - offsetPx) / span);
}

/** Resolve a ValueSpec to a concrete 0..1 value given the action's context. */
export function resolveValue(
  spec: ValueSpec,
  ctx: { latencyMs?: number; offsetPx?: number },
): number {
  if (typeof spec === "number") return spec;
  switch (spec.fn) {
    case "decision":
      return clamp01(spec.base + spec.span * decisionValue(ctx.latencyMs ?? SLOW_DECISION_MS));
    case "decisionRaw":
      return decisionValue(ctx.latencyMs ?? SLOW_DECISION_MS);
    case "precision":
      return precisionValue(ctx.offsetPx ?? LOOSE_PX);
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
