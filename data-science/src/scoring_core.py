"""The scoring engine, in Python.

A line-for-line port of frontend/src/lib/scoring/engine.ts (the TypeScript
original) and backend/.../scoring/ScoringEngine.java (its Java twin). All three
are held to the same file, golden-vectors.json: tests/test_golden.py replays
every case here and fails if one number differs by more than 1e-9.

For each contribution on a domain or sub-signal, in `startedAt` order:

    alpha     = base_alpha x confidence                   (0.25 x confidence)
    baseline  = mean of the prior raws    (the level until there are 3 of them)
    sd        = sample SD of the prior raws (12 until there are 5; never below 3)
    velocity  = (raw - baseline) / sd
    level'    = level x (1 - alpha) + raw x alpha         (starts at 50)
    domain confidence = min(1, observations / 12)
    status    = stable while domain confidence < 0.35, else from the velocity:
                <= -1.5 decline, <= -0.8 watch, >= 1.0 improving, else stable

"Prior" means before this contribution: a raw is never compared with a mean
that already contains it. The alert rules (SINGLE, TWO_CONSECUTIVE, CUSUM) are
answered by `alert_for`, and every rule's bookkeeping is kept on every step, so
the rule can be switched without replaying history.

Do not "improve" the arithmetic here without changing the TypeScript first and
regenerating the golden file: sums run oldest-first, the SD uses n - 1, and
nothing is rounded.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Iterable, Mapping, Optional, Sequence

ENGINE_VERSION = "1.0.0"

DOMAIN_IDS = ("LANGUAGE", "VISUAL_SEMANTIC", "MOTOR", "AFFECTIVE", "TEMPORAL", "EXECUTIVE")
SUB_SIGNAL_IDS = (
    "WORKING_MEMORY_SPAN",
    "INHIBITORY_CONTROL",
    "COGNITIVE_FLEXIBILITY",
    "TRAJECTORY_PREDICTION",
    "REACTION_SPEED",
    "SUSTAINED_ATTENTION",
)
TARGET_IDS = DOMAIN_IDS + SUB_SIGNAL_IDS
ALERT_RULES = ("TWO_CONSECUTIVE", "SINGLE", "CUSUM")
STATUSES = ("stable", "watch", "decline", "improving")


@dataclass(frozen=True)
class ScoringConfig:
    base_alpha: float = 0.25
    start_level: float = 50.0
    window: int = 30
    min_baseline_observations: int = 3
    min_sd_observations: int = 5
    prior_sd: float = 12.0
    min_sd: float = 3.0
    full_confidence_observations: int = 12
    confidence_gate: float = 0.35
    decline_velocity: float = -1.5
    watch_velocity: float = -0.8
    improving_velocity: float = 1.0
    alert_rule: str = "TWO_CONSECUTIVE"
    cusum_k: float = 0.5
    cusum_h: float = 4.0

    def with_(self, **changes) -> "ScoringConfig":
        return replace(self, **changes)

    @staticmethod
    def from_golden(cfg: Mapping) -> "ScoringConfig":
        """Build from the camelCase `config` object in golden-vectors.json."""
        names = {
            "baseAlpha": "base_alpha",
            "startLevel": "start_level",
            "window": "window",
            "minBaselineObservations": "min_baseline_observations",
            "minSdObservations": "min_sd_observations",
            "priorSd": "prior_sd",
            "minSd": "min_sd",
            "fullConfidenceObservations": "full_confidence_observations",
            "confidenceGate": "confidence_gate",
            "declineVelocity": "decline_velocity",
            "watchVelocity": "watch_velocity",
            "improvingVelocity": "improving_velocity",
            "alertRule": "alert_rule",
            "cusumK": "cusum_k",
            "cusumH": "cusum_h",
        }
        unknown = set(cfg) - set(names)
        if unknown:
            raise KeyError(f"unknown config keys in the golden file: {sorted(unknown)}")
        return ScoringConfig(**{names[k]: v for k, v in cfg.items()})


DEFAULT_CONFIG = ScoringConfig()


@dataclass
class TargetState:
    level: float
    observations: int = 0
    raws: list = field(default_factory=list)
    run_watch: int = 0
    run_decline: int = 0
    cusum: float = 0.0

    def to_golden(self) -> dict:
        return {
            "level": self.level,
            "observations": self.observations,
            "raws": list(self.raws),
            "runWatch": self.run_watch,
            "runDecline": self.run_decline,
            "cusum": self.cusum,
        }

    @staticmethod
    def from_golden(d: Mapping) -> "TargetState":
        return TargetState(
            level=d["level"],
            observations=d["observations"],
            raws=list(d["raws"]),
            run_watch=d["runWatch"],
            run_decline=d["runDecline"],
            cusum=d["cusum"],
        )


@dataclass(frozen=True)
class Reading:
    target: str
    raw: float
    confidence: float
    level: float
    baseline: float
    sd: float
    velocity: float
    domain_confidence: float
    status: str
    alert: Optional[str]


def initial_target_state(config: ScoringConfig = DEFAULT_CONFIG) -> TargetState:
    return TargetState(level=config.start_level)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def sanitize_contribution(target: str, raw: float, confidence: float):
    """(raw, confidence) the engine will accept, or None if there is no usable evidence."""
    if target not in TARGET_IDS:
        return None
    if not (math.isfinite(raw) and math.isfinite(confidence)):
        return None
    confidence = _clamp(confidence, 0.0, 1.0)
    if confidence <= 0:
        return None
    return _clamp(raw, 0.0, 100.0), confidence


def mean(xs: Sequence[float]) -> float:
    total = 0.0
    for x in xs:  # oldest first, as in the other two engines
        total += x
    return total / len(xs)


def sample_sd(xs: Sequence[float]) -> float:
    """Sample standard deviation (n - 1)."""
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    ss = 0.0
    for x in xs:
        ss += (x - m) * (x - m)
    return math.sqrt(ss / (len(xs) - 1))


def status_for(velocity: float, config: ScoringConfig = DEFAULT_CONFIG) -> str:
    if velocity <= config.decline_velocity:
        return "decline"
    if velocity <= config.watch_velocity:
        return "watch"
    if velocity >= config.improving_velocity:
        return "improving"
    return "stable"


def alert_for(state: TargetState, velocity: float, config: ScoringConfig = DEFAULT_CONFIG) -> Optional[str]:
    """Should this contribution raise an alert, under the configured rule?

    Called only for contributions past the confidence gate; `state` is the state
    after this contribution.
    """
    rule = config.alert_rule
    if rule == "SINGLE":
        if velocity <= config.decline_velocity:
            return "decline"
        if velocity <= config.watch_velocity:
            return "watch"
        return None
    if rule == "TWO_CONSECUTIVE":
        if state.run_decline >= 2:
            return "decline"
        if state.run_watch >= 2:
            return "watch"
        return None
    if rule == "CUSUM":
        if state.cusum >= config.cusum_h:
            return "decline"
        if state.cusum >= config.cusum_h / 2:
            return "watch"
        return None
    raise ValueError(f"unknown alert rule {rule!r}")


def apply_to_target(
    prior: Optional[TargetState],
    target: str,
    raw: float,
    confidence: float,
    config: ScoringConfig = DEFAULT_CONFIG,
):
    """Apply one contribution to one target's state. Returns (state, reading) or None."""
    clean = sanitize_contribution(target, raw, confidence)
    if clean is None:
        return None
    raw, confidence = clean
    before = prior if prior is not None else initial_target_state(config)

    n = len(before.raws)
    baseline = mean(before.raws) if n >= config.min_baseline_observations else before.level
    sd = max(config.min_sd, sample_sd(before.raws)) if n >= config.min_sd_observations else config.prior_sd
    velocity = (raw - baseline) / sd

    alpha = config.base_alpha * confidence
    level = before.level * (1 - alpha) + raw * alpha
    observations = before.observations + 1
    raws = (before.raws + [raw])[-config.window:]
    domain_confidence = min(1.0, observations / config.full_confidence_observations)

    gated = domain_confidence < config.confidence_gate
    status = "stable" if gated else status_for(velocity, config)

    run_watch = before.run_watch + 1 if (not gated and velocity <= config.watch_velocity) else 0
    run_decline = before.run_decline + 1 if (not gated and velocity <= config.decline_velocity) else 0
    cusum = 0.0 if gated else max(0.0, before.cusum + (-velocity - config.cusum_k))

    state = TargetState(level, observations, raws, run_watch, run_decline, cusum)
    reading = Reading(
        target=target,
        raw=raw,
        confidence=confidence,
        level=level,
        baseline=baseline,
        sd=sd,
        velocity=velocity,
        domain_confidence=domain_confidence,
        status=status,
        alert=None if gated else alert_for(state, velocity, config),
    )
    return state, reading


def apply_session(
    state: Mapping[str, TargetState],
    contributions: Iterable[tuple],
    config: ScoringConfig = DEFAULT_CONFIG,
):
    """Apply one session's (target, raw, confidence) contributions in the order given.

    Returns (new_state, readings). Unusable contributions are skipped.
    """
    new_state = dict(state)
    readings = []
    for target, raw, confidence in contributions:
        out = apply_to_target(new_state.get(target), target, raw, confidence, config)
        if out is None:
            continue
        new_state[target], reading = out
        readings.append(reading)
    return new_state, readings


def replay(sessions: Iterable[Iterable[tuple]], config: ScoringConfig = DEFAULT_CONFIG, initial=None):
    """Rebuild a state from scratch; `sessions` must already be in startedAt order."""
    state = dict(initial or {})
    for contributions in sessions:
        state, _ = apply_session(state, contributions, config)
    return state
