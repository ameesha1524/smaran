"""Run a cohort's contributions through the engine, one (patient, domain) sequence at a time.

The engine keeps state per patient per target, so a sequence is independent of every other.
`replay_frame` returns one row per contribution with everything the alert rules need
(velocity, the CUSUM, whether the confidence gate was closed, the engine's own alert), and
`SequenceIndex` slices that frame back into sequences without a groupby per call.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import scoring_core as sc

ALERT_CODE = {None: 0, "watch": 1, "decline": 2}
STATUS_CODE = {"stable": 0, "watch": 1, "decline": 2, "improving": 3}

COLUMNS = ["patient_idx", "target", "session_idx", "day", "raw", "confidence"]


def replay_frame(contributions: pd.DataFrame, config: sc.ScoringConfig = sc.DEFAULT_CONFIG) -> pd.DataFrame:
    """The engine's reading for every contribution.

    `contributions` needs patient_idx, target, session_idx, day, raw, confidence, and is replayed in
    session order within each (patient, target).
    """
    c = contributions.sort_values(["patient_idx", "target", "session_idx"], kind="stable").reset_index(drop=True)
    n = len(c)
    out = {k: np.empty(n) for k in ("level", "baseline", "sd", "velocity", "domain_confidence", "cusum")}
    out["alert"] = np.zeros(n, dtype=np.int8)
    out["status"] = np.zeros(n, dtype=np.int8)
    out["obs"] = np.zeros(n, dtype=np.int32)

    patients = c.patient_idx.to_numpy()
    targets = c.target.to_numpy()
    raws = c.raw.to_numpy(dtype=float)
    confs = c.confidence.to_numpy(dtype=float)

    state = None
    prev_key = None
    for i in range(n):
        key = (patients[i], targets[i])
        if key != prev_key:
            state = None
            prev_key = key
        applied = sc.apply_to_target(state, targets[i], raws[i], confs[i], config)
        if applied is None:  # unusable: the row stays, flagged as never-alerting
            out["level"][i] = state.level if state else config.start_level
            for k in ("baseline", "sd", "velocity", "cusum"):
                out[k][i] = np.nan
            out["domain_confidence"][i] = (state.observations if state else 0) / config.full_confidence_observations
            out["obs"][i] = state.observations if state else 0
            continue
        state, r = applied
        out["level"][i] = r.level
        out["baseline"][i] = r.baseline
        out["sd"][i] = r.sd
        out["velocity"][i] = r.velocity
        out["domain_confidence"][i] = r.domain_confidence
        out["cusum"][i] = state.cusum
        out["alert"][i] = ALERT_CODE[r.alert]
        out["status"][i] = STATUS_CODE[r.status]
        out["obs"][i] = state.observations

    frame = c[COLUMNS].copy()
    for k, v in out.items():
        frame[k] = v
    frame["gated"] = frame.domain_confidence < config.confidence_gate
    return frame


@dataclass
class SequenceIndex:
    """Start and end offsets of each (patient, target) run in a replay frame."""

    keys: list
    starts: np.ndarray
    ends: np.ndarray

    @staticmethod
    def of(frame: pd.DataFrame) -> "SequenceIndex":
        patients = frame.patient_idx.to_numpy()
        targets = frame.target.to_numpy()
        change = np.ones(len(frame), dtype=bool)
        change[1:] = (patients[1:] != patients[:-1]) | (targets[1:] != targets[:-1])
        starts = np.flatnonzero(change)
        ends = np.append(starts[1:], len(frame))
        keys = [(int(patients[s]), str(targets[s])) for s in starts]
        return SequenceIndex(keys, starts, ends)

    def __iter__(self):
        for key, s, e in zip(self.keys, self.starts, self.ends):
            yield key, slice(int(s), int(e))


def previous_in_sequence(values: np.ndarray, index: SequenceIndex, fill: float) -> np.ndarray:
    """values shifted by one within each sequence (the first element gets `fill`)."""
    out = np.empty_like(values)
    out[1:] = values[:-1]
    out[index.starts] = fill
    return out
