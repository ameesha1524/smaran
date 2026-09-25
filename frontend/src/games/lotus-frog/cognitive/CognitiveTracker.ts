// The cognitive instrument that watches one session of the Lotus Frog game.
//
// It is fed two ways:
//   · the Scene calls its action hooks as it routes taps (onBugTargeted,
//     onFrogPoke, onBigCroak, onWaterTap);
//   · once per frame the Scene calls `observe(...)`, which reconciles targeting
//     into completed catches (watching `bugsResolved`), stamps when each bug
//     first appeared (for decision latency), and accounts active vs. idle time,
//     doze transitions, and periodic "watching" credit.
//
// At the end it produces a single FrogSessionReport (batch, per the design):
// a five-domain reading plus the raw behavioural breakdown. It holds no
// rendering and no game logic — it only measures.

import type { World } from "../engine/World";
import type { CogDomain } from "./domains";
import { COG_DOMAINS } from "./domains";
import type { FrogSessionReport, RawSignals } from "./report";
import {
  ACTION_MODEL,
  CONFIDENCE_FULL_WEIGHT,
  HESITATION_MS,
  IDLE_WATCH_EVERY_S,
  MIN_MEANINGFUL_CATCHES,
  MIS_TAP_RADIUS_PX,
  resolveValue,
  type CogActionKind,
} from "./tuning";

/** Minimal shape the tracker needs from a bug — Bug satisfies it structurally. */
interface TrackedBug {
  x: number;
  y: number;
  alive: boolean;
  caught: boolean;
  readonly kind: string;
}

/** A tap the player aimed at a bug, awaiting its catch to complete (FIFO). */
interface PendingTarget {
  bug: TrackedBug;
  appearedT: number; // world.t when the bug was first seen
  clickT: number; // world.t at the tap
  offsetPx: number; // tap distance from bug centre
}

/** One domain's running accumulator: Σ(weight·value) and Σ(weight). */
interface Accum {
  sumWV: number;
  sumW: number;
}

export class CognitiveTracker {
  private started = false;
  private startWallClock = 0; // Date.now() at session start
  private lastT = 0; // world.t last observed

  private readonly acc: Record<CogDomain, Accum> = blankAcc();

  // Bug bookkeeping.
  private readonly appeared = new WeakMap<TrackedBug, number>();
  private readonly pending: PendingTarget[] = [];
  private lastBugsResolved = 0;

  // Raw signal tallies.
  private catches = 0;
  private misTaps = 0;
  private waterPlays = 0;
  private pokes = 0;
  private bigCroaks = 0;
  private hops = 0;
  private lastHopCount = 0;
  private dozes = 0;
  private readonly kindCounts: Record<string, number> = {};
  private readonly decisionLatenciesMs: number[] = [];
  private readonly tapOffsetsPx: number[] = [];
  private hesitations = 0;

  private activeS = 0;
  private idleS = 0;
  private idleWatchClock = 0;
  private wasAsleep = false;

  /** Begin a session. Call once when the patient enters the game. */
  begin(world: World): void {
    this.started = true;
    this.startWallClock = Date.now();
    this.lastT = world.t;
    this.lastBugsResolved = world.progress.bugsResolved;
  }

  // ── Action hooks (the Scene calls these as it routes taps) ────────────────

  /** A bug was tapped: the frog will now go and eat it. Records the targeting
   *  so the catch can be scored when `bugsResolved` next ticks up. */
  onBugTargeted(bug: TrackedBug, clickX: number, clickY: number, world: World): void {
    if (!this.started) return;
    const appearedT = this.appeared.get(bug) ?? world.t;
    const offsetPx = Math.hypot(clickX - bug.x, clickY - bug.y);
    this.pending.push({ bug, appearedT, clickT: world.t, offsetPx });
    this.noteActive();
  }

  /** A tap that hit neither bug nor frog. `nearestBugDistPx` classifies it as a
   *  targeting miss (reaching for a bug) or calm water play. */
  onEmptyTap(nearestBugDistPx: number): void {
    if (!this.started) return;
    if (nearestBugDistPx <= MIS_TAP_RADIUS_PX) {
      this.misTaps++;
      this.emit("misTapNear", {});
    } else {
      this.waterPlays++;
      this.emit("waterPlay", {});
    }
    this.noteActive();
  }

  onFrogPoke(offsetPx: number): void {
    if (!this.started) return;
    this.pokes++;
    this.emit("frogPoke", { offsetPx });
    this.noteActive();
  }

  onBigCroak(): void {
    if (!this.started) return;
    this.bigCroaks++;
    this.emit("bigCroak", {});
    this.noteActive();
  }

  // ── Per-frame observation ─────────────────────────────────────────────────

  /**
   * Reconcile game state once per frame:
   *  · stamp first-appearance times for new bugs (decision latency needs them);
   *  · turn `bugsResolved` increments into scored catches (FIFO against pending);
   *  · count new pad-hops;
   *  · account active vs. idle seconds, periodic watching credit, and dozing.
   */
  observe(
    world: World,
    bugs: readonly TrackedBug[],
    frog: { sleeping: boolean; hopCount: number },
  ): void {
    if (!this.started) return;
    const dt = Math.max(0, world.t - this.lastT);
    this.lastT = world.t;

    // Stamp any bug we haven't seen before with its appearance time.
    for (const b of bugs) {
      if (!this.appeared.has(b)) this.appeared.set(b, world.t);
    }

    // Completed catches: bugsResolved rose by N → score the N oldest targets.
    let resolved = world.progress.bugsResolved - this.lastBugsResolved;
    this.lastBugsResolved = world.progress.bugsResolved;
    while (resolved > 0 && this.pending.length > 0) {
      const t = this.pending.shift()!;
      this.scoreCatch(t);
      resolved--;
    }
    // If bugsResolved rose without a matching target (shouldn't normally),
    // credit a plain catch so the tally stays honest.
    while (resolved > 0) {
      this.catches++;
      resolved--;
    }

    // New hops since last frame.
    if (frog.hopCount > this.lastHopCount) {
      const n = frog.hopCount - this.lastHopCount;
      this.lastHopCount = frog.hopCount;
      for (let i = 0; i < n; i++) {
        this.hops++;
        this.emit("hop", {});
      }
    }

    // Doze: a rising edge into sleep is one withdrawal event.
    if (frog.sleeping && !this.wasAsleep) {
      this.dozes++;
      this.emit("doze", {});
    }
    this.wasAsleep = frog.sleeping;

    // Active vs. idle time. "Active" is any second within a short grace of the
    // last real action; otherwise idle. Dozing is always idle.
    if (frog.sleeping) {
      this.idleS += dt;
    } else if (world.t - this.lastActionT <= 2) {
      this.activeS += dt;
    } else {
      this.idleS += dt;
      // While present and awake but not acting, credit a calm "watching" tick
      // on a slow cadence so it forms a baseline without dominating.
      this.idleWatchClock += dt;
      if (this.idleWatchClock >= IDLE_WATCH_EVERY_S) {
        this.idleWatchClock -= IDLE_WATCH_EVERY_S;
        this.emit("idleWatch", {});
      }
    }
  }

  // ── Finalise ──────────────────────────────────────────────────────────────

  /** Produce the batch report. Safe to call once at session end. */
  end(): FrogSessionReport {
    const endWall = Date.now();
    const durationMs = endWall - this.startWallClock;

    const domains = {} as FrogSessionReport["domains"];
    for (const d of COG_DOMAINS) {
      const a = this.acc[d];
      if (a.sumW <= 0) {
        domains[d] = { score: null, evidenceWeight: 0, confidence: 0 };
      } else {
        domains[d] = {
          score: round(a.sumWV / a.sumW),
          evidenceWeight: round(a.sumW),
          confidence: round(clamp01(a.sumW / CONFIDENCE_FULL_WEIGHT)),
        };
      }
    }

    const measured = COG_DOMAINS.map((d) => domains[d].score).filter(
      (s): s is number => s !== null,
    );
    const completionRate = measured.length
      ? round(measured.reduce((x, y) => x + y, 0) / measured.length)
      : 0.5;

    const totalS = this.activeS + this.idleS;
    const engagementRatio = totalS > 0 ? clamp01(this.activeS / totalS) : 0;
    const hesitationRate = this.catches > 0 ? this.hesitations / this.catches : 0;
    const cognitiveLoadScore = round(
      clamp01(0.2 + 0.5 * hesitationRate + 0.3 * (1 - engagementRatio)),
    );

    const abandoned = this.catches < MIN_MEANINGFUL_CATCHES && engagementRatio < 0.25;

    const raw: RawSignals = {
      catches: this.catches,
      misTaps: this.misTaps,
      waterPlays: this.waterPlays,
      pokes: this.pokes,
      bigCroaks: this.bigCroaks,
      hops: this.hops,
      dozes: this.dozes,
      distinctKinds: Object.keys(this.kindCounts).length,
      kindCounts: { ...this.kindCounts },
      decisionLatenciesMs: [...this.decisionLatenciesMs],
      medianDecisionMs: median(this.decisionLatenciesMs),
      hesitations: this.hesitations,
      tapOffsetsPx: this.tapOffsetsPx.map(round),
      meanTapOffsetPx: mean(this.tapOffsetsPx),
      activeSeconds: round(this.activeS),
      idleSeconds: round(this.idleS),
      engagementRatio: round(engagementRatio),
    };

    return {
      gameType: "LOTUS_FROG",
      startedAt: new Date(this.startWallClock).toISOString(),
      endedAt: new Date(endWall).toISOString(),
      durationMs,
      domains,
      completionRate,
      cognitiveLoadScore,
      abandoned,
      raw,
      highlights: this.buildHighlights(raw, engagementRatio),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private lastActionT = -Infinity;

  private noteActive(): void {
    this.lastActionT = this.lastT;
  }

  /** Score a completed catch: latency, precision, hesitation, kind breadth. */
  private scoreCatch(t: PendingTarget): void {
    this.catches++;
    const latencyMs = Math.max(0, (t.clickT - t.appearedT) * 1000);
    this.decisionLatenciesMs.push(Math.round(latencyMs));
    this.tapOffsetsPx.push(t.offsetPx);
    if (latencyMs > HESITATION_MS) this.hesitations++;

    const kind = t.bug.kind;
    const firstOfKind = !this.kindCounts[kind];
    this.kindCounts[kind] = (this.kindCounts[kind] ?? 0) + 1;

    this.emit("catch", { latencyMs, offsetPx: t.offsetPx });
    if (firstOfKind) this.emit("kindDiscovered", {});
    this.noteActive();
  }

  /** Apply an action's evidence to the domain accumulators. */
  private emit(kind: CogActionKind, ctx: { latencyMs?: number; offsetPx?: number }): void {
    const impact = ACTION_MODEL[kind];
    for (const d of COG_DOMAINS) {
      const ev = impact[d];
      if (!ev) continue;
      const value = resolveValue(ev.value, ctx);
      const a = this.acc[d];
      a.sumWV += ev.weight * value;
      a.sumW += ev.weight;
    }
  }

  private buildHighlights(raw: RawSignals, engagement: number): string[] {
    const out: string[] = [];
    out.push(`Caught ${raw.catches} bug${raw.catches === 1 ? "" : "s"} across ${raw.distinctKinds} kind${raw.distinctKinds === 1 ? "" : "s"}.`);
    if (raw.medianDecisionMs != null) {
      out.push(`Typically spotted and tapped a bug in ${(raw.medianDecisionMs / 1000).toFixed(1)}s.`);
    }
    if (raw.hesitations > 0) {
      out.push(`${raw.hesitations} long pause${raw.hesitations === 1 ? "" : "s"} before acting.`);
    }
    if (raw.pokes + raw.bigCroaks + raw.waterPlays > 0) {
      out.push(`Played with the frog and water ${raw.pokes + raw.bigCroaks + raw.waterPlays} time${raw.pokes + raw.bigCroaks + raw.waterPlays === 1 ? "" : "s"}.`);
    }
    if (raw.dozes > 0) {
      out.push(`Drifted off ${raw.dozes} time${raw.dozes === 1 ? "" : "s"} during the visit.`);
    }
    out.push(`Actively engaged about ${Math.round(engagement * 100)}% of the visit.`);
    return out;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function blankAcc(): Record<CogDomain, Accum> {
  return {
    language: { sumWV: 0, sumW: 0 },
    visualSemantic: { sumWV: 0, sumW: 0 },
    motor: { sumWV: 0, sumW: 0 },
    affective: { sumWV: 0, sumW: 0 },
    temporal: { sumWV: 0, sumW: 0 },
  };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round(n: number): number {
  return Number(n.toFixed(3));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length);
}
