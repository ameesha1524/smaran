"""The four alert rules of Appendix C, as scores that can be swept, and the metrics that judge them.

  R0  absolute level: the EMA level is at or below a fixed cut-off
  R1  single-session velocity: this session is far enough under her own usual
  R2  two-consecutive velocity: this and the previous session both are (the product default)
  R3  CUSUM: the lower CUSUM of velocity has crossed a threshold

Each rule is written here as an *alarm score* per contribution (higher = more alarming), so a
threshold sweep is one comparison and a ROC/PR curve is a sort. At the default threshold each
of R1, R2 and R3 fires exactly where the engine's own `alert` does (tests/test_rules.py checks
that against scoring_core, so this file cannot quietly drift from the engine).

Units of evaluation, stated once:

  * A *pair* is one patient and one domain. A pair is *declining* if the ground truth gives it a
    downward change point; every other pair (stable, improving, or before the onset) is a negative.
  * A *fire* is a contribution at which the rule says alert. An *episode* is a run of fires with
    gaps of no more than EPISODE_GAP_DAYS between them: one thing a family would be told about.
  * *Detection delay* is days from the true onset to the first fire on or after it. A pair is
    "detected within W days" if that delay is at most W; pairs whose follow-up ended before onset + W
    are not counted for W (a patient who stopped playing did not fail to be detected).
  * A *false alarm* is an episode that starts in a pair's negative time. Rates are per patient-year
    with all six domains monitored.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import scoring_core as sc
from replay import SequenceIndex, previous_in_sequence

RULES = ("R0", "R1", "R2", "R3")
RULE_NAMES = {
    "R0": "Absolute level",
    "R1": "Single-session velocity",
    "R2": "Two-consecutive velocity",
    "R3": "CUSUM",
}
EPISODE_GAP_DAYS = 7
WINDOWS = (14, 30, 60, 90)
HORIZON = 90  # delay is censored here for the restricted mean
WARMUP_DAYS = 21  # "the first weeks": what the confidence gate exists for

#: the thresholds at which each rule is run "as shipped" (in alarm-score units)
DEFAULT_THRESHOLD = {
    "R0": -40.0,  # level <= 40. A round number a person might choose; not tuned.
    "R1": 0.8,    # velocity <= -0.8, the engine's watch threshold
    "R2": 0.8,
    "R3": 2.0,    # CUSUM >= h / 2, the engine's watch level
}
SWEEP = {
    "R0": np.linspace(-72.0, -8.0, 33),
    "R1": np.linspace(0.2, 4.0, 40),
    "R2": np.linspace(0.2, 4.0, 40),
    "R3": np.linspace(0.5, 14.0, 45),
}
NEG_INF = -np.inf


def alarm_scores(frame: pd.DataFrame, index: SequenceIndex, rule: str) -> np.ndarray:
    """Higher means more alarming; -inf where the rule cannot speak (the confidence gate is closed)."""
    eligible = ~frame.gated.to_numpy() & np.isfinite(frame.velocity.to_numpy())
    v = frame.velocity.to_numpy()
    if rule == "R0":
        s = -frame.level.to_numpy()
    elif rule == "R1":
        s = -v
    elif rule == "R2":
        prev_v = previous_in_sequence(v, index, np.nan)
        prev_ok = previous_in_sequence(eligible.astype(float), index, 0.0) > 0
        s = -np.maximum(v, prev_v)  # both must be under the threshold
        eligible = eligible & prev_ok
    elif rule == "R3":
        s = frame.cusum.to_numpy().copy()
    else:
        raise ValueError(rule)
    return np.where(eligible & np.isfinite(s), s, NEG_INF)


def episode_starts(fire_days: np.ndarray, gap: int = EPISODE_GAP_DAYS) -> np.ndarray:
    if len(fire_days) == 0:
        return fire_days
    new = np.ones(len(fire_days), dtype=bool)
    new[1:] = np.diff(fire_days) > gap
    return fire_days[new]


@dataclass
class Truth:
    """Ground truth by patient and domain, plus where each patient's follow-up begins and ends."""

    onset: dict      # (patient_idx, domain) -> onset day or nan
    direction: dict  # (patient_idx, domain) -> -1 / 0 / +1
    start_day: np.ndarray
    end_day: np.ndarray
    latent: np.ndarray  # (patients, days, 6)
    kind: np.ndarray    # trajectory per patient
    base_level: np.ndarray  # (patients,) mean base level

    @staticmethod
    def of(cohort) -> "Truth":
        t = cohort.truth
        onset = {(int(r.patient_idx), r.domain): float(r.onset_day) for r in t.itertuples()}
        direction = {(int(r.patient_idx), r.domain): int(r.direction) for r in t.itertuples()}
        s = cohort.sessions.groupby("patient_idx").day.agg(["min", "max"]).reindex(range(cohort.params.n_patients))
        start = s["min"].fillna(0).to_numpy(dtype=int)
        end = s["max"].fillna(0).to_numpy(dtype=int)
        kind = cohort.patients.sort_values("patient_idx").trajectory.to_numpy()
        base = cohort.patients.sort_values("patient_idx").level_mean.to_numpy()
        return Truth(onset, direction, start, end, cohort.latent, kind, base)


@dataclass
class PerPatient:
    """What each patient contributes to every metric, so a bootstrap can resample patients cheaply."""

    n: int
    hits: dict          # W -> hits per patient
    risk: dict          # W -> at-risk pairs per patient
    min_delay_sum: np.ndarray   # sum of min(delay, HORIZON) over pairs with HORIZON of follow-up
    min_delay_n: np.ndarray
    episodes_neg: np.ndarray
    episodes_warm: np.ndarray   # of those, the ones that began in the patient's first WARMUP_DAYS
    neg_pair_days: np.ndarray   # negative exposure summed over the six domains (days)
    pairs: list         # per patient: (follow-up days after onset, delay or inf) for each declining pair
    delays: list        # per patient: delays of detected positive pairs
    drops: list         # per patient: true points lost at the moment of detection
    stable: np.ndarray
    kind: np.ndarray
    base_level: np.ndarray


def evaluate_fires(frame: pd.DataFrame, index: SequenceIndex, fires: np.ndarray, truth: Truth) -> PerPatient:
    n = len(truth.end_day)
    hits = {w: np.zeros(n) for w in WINDOWS}
    risk = {w: np.zeros(n) for w in WINDOWS}
    min_delay_sum = np.zeros(n)
    min_delay_n = np.zeros(n)
    episodes_neg = np.zeros(n)
    episodes_warm = np.zeros(n)
    neg_days = np.zeros(n)
    pairs = [[] for _ in range(n)]
    delays = [[] for _ in range(n)]
    drops = [[] for _ in range(n)]
    days = frame.day.to_numpy()
    domain_index = {d: i for i, d in enumerate(sc.DOMAIN_IDS)}

    for (patient, domain), sl in index:
        start, end = int(truth.start_day[patient]), int(truth.end_day[patient])
        onset = truth.onset[(patient, domain)]
        declining = truth.direction[(patient, domain)] < 0
        fire_days = days[sl][fires[sl]]
        starts = episode_starts(fire_days)

        if declining:
            o = int(onset)
            neg_days[patient] += max(0, min(o, end + 1) - start)
            episodes_neg[patient] += int(np.sum(starts < o))
            episodes_warm[patient] += int(np.sum(starts < min(o, start + WARMUP_DAYS)))
            follow = end - o
            pos = np.searchsorted(fire_days, o)
            delay = int(fire_days[pos]) - o if pos < len(fire_days) else None
            for w in WINDOWS:
                if follow >= w:
                    risk[w][patient] += 1
                    hits[w][patient] += delay is not None and delay <= w
            pairs[patient].append((follow, float(delay) if delay is not None else np.inf))
            if follow >= HORIZON:
                min_delay_n[patient] += 1
                min_delay_sum[patient] += min(delay, HORIZON) if delay is not None else HORIZON
            if delay is not None:
                delays[patient].append(delay)
                d_idx = domain_index[domain]
                drops[patient].append(float(truth.latent[patient, o, d_idx] - truth.latent[patient, o + delay, d_idx]))
        else:
            neg_days[patient] += end - start + 1
            episodes_neg[patient] += len(starts)
            episodes_warm[patient] += int(np.sum(starts < start + WARMUP_DAYS))

    return PerPatient(
        n=n, hits=hits, risk=risk, min_delay_sum=min_delay_sum, min_delay_n=min_delay_n,
        episodes_neg=episodes_neg, episodes_warm=episodes_warm, neg_pair_days=neg_days, pairs=pairs,
        delays=delays, drops=drops,
        stable=(truth.kind == "stable"), kind=truth.kind, base_level=truth.base_level,
    )


# ------------------------------------------------------------------ metrics


def _ratio(num: float, den: float) -> float:
    return float(num / den) if den > 0 else float("nan")


def metrics(pp: PerPatient, idx: np.ndarray | None = None) -> dict:
    """Every headline number, for the patients in `idx` (default all). Used for the point estimate and each resample."""
    if idx is None:
        idx = np.arange(pp.n)
    out = {}
    for w in WINDOWS:
        out[f"sens_{w}d"] = _ratio(pp.hits[w][idx].sum(), pp.risk[w][idx].sum())
    out["rmtd_90d"] = _ratio(pp.min_delay_sum[idx].sum(), pp.min_delay_n[idx].sum())
    detected = [x for i in idx for x in pp.delays[i]]
    out["median_delay_days"] = float(np.median(detected)) if detected else float("nan")
    drop = [x for i in idx for x in pp.drops[i]]
    out["median_points_lost_at_detection"] = float(np.median(drop)) if drop else float("nan")
    s = idx[pp.stable[idx]]
    out["false_alarms_per_patient_year_stable"] = _ratio(pp.episodes_neg[s].sum(), pp.neg_pair_days[s].sum() / 6 / 365.25)
    out["warmup_false_alarms_per_stable_patient"] = _ratio(pp.episodes_warm[s].sum(), len(s))
    out["false_alarms_per_patient_year_all_negative_time"] = _ratio(
        pp.episodes_neg[idx].sum(), pp.neg_pair_days[idx].sum() / 6 / 365.25
    )
    return out


def bootstrap(pp: PerPatient, n_boot: int = 1000, seed: int = 0, keys: tuple | None = None) -> pd.DataFrame:
    """Percentile 95% intervals from a patient-level bootstrap (the patient is the unit that is resampled)."""
    rng = np.random.default_rng(np.random.SeedSequence([seed, 99]))
    rows = []
    for _ in range(n_boot):
        rows.append(metrics(pp, rng.integers(0, pp.n, pp.n)))
    df = pd.DataFrame(rows)
    if keys:
        df = df[list(keys)]
    return df


def with_intervals(pp: PerPatient, n_boot: int = 1000, seed: int = 0) -> dict:
    point = metrics(pp)
    boots = bootstrap(pp, n_boot, seed)
    out = {}
    for k, v in point.items():
        lo, hi = np.nanpercentile(boots[k], [2.5, 97.5])
        out[k] = v
        out[f"{k}_lo"] = float(lo)
        out[f"{k}_hi"] = float(hi)
    return out


# ----------------------------------------------------------- window-level ROC / PR


def window_table(frame: pd.DataFrame, index: SequenceIndex, score: np.ndarray, truth: Truth,
                 width: int = 14, horizon: int = 30) -> pd.DataFrame:
    """One row per (pair, 14-day window) that has at least one session.

    label 1: the window ends within `horizon` days after a true onset (the change had just begun)
    label 0: the window ends before any onset, or belongs to a pair that never declines
    windows ending later than onset + horizon are left out: by then the question is not early detection.
    The window's score is the most alarming contribution in it.
    """
    days = frame.day.to_numpy()
    seq = np.repeat(np.arange(len(index.starts)), index.ends - index.starts)
    start = np.array([truth.start_day[p] for p, _ in index.keys])
    win = (days - start[seq]) // width
    df = pd.DataFrame({"seq": seq, "win": win, "score": score})
    g = df.groupby(["seq", "win"], sort=True).score.max().reset_index()

    patients = np.array([k[0] for k in index.keys])
    rows_onset = np.array([truth.onset[k] if truth.direction[k] < 0 else np.nan for k in index.keys])
    w_end = start[g.seq.to_numpy()] + (g.win.to_numpy() + 1) * width - 1
    onset = rows_onset[g.seq.to_numpy()]
    declining = ~np.isnan(onset)
    label = np.zeros(len(g), dtype=int)
    keep = np.ones(len(g), dtype=bool)
    after = declining & (w_end >= onset)
    label[after & (w_end <= onset + horizon)] = 1
    keep[after & (w_end > onset + horizon)] = False
    g["patient_idx"] = patients[g.seq.to_numpy()]
    g["label"] = label
    return g[keep].reset_index(drop=True)[["patient_idx", "label", "score"]]


def weighted_roc_pr(score: np.ndarray, label: np.ndarray, weight: np.ndarray):
    """AUC (ROC) and average precision with case weights and tie-aware ranking; weights are patient multiplicities."""
    order = np.argsort(-score, kind="stable")
    s, y, w = score[order], label[order], weight[order]
    # group tied scores
    new = np.ones(len(s), dtype=bool)
    new[1:] = s[1:] != s[:-1]
    gid = np.cumsum(new) - 1
    ng = gid[-1] + 1
    pos = np.bincount(gid, weights=w * y, minlength=ng)
    neg = np.bincount(gid, weights=w * (1 - y), minlength=ng)
    P, N = pos.sum(), neg.sum()
    if P == 0 or N == 0:
        return float("nan"), float("nan")
    tp, fp = np.cumsum(pos), np.cumsum(neg)
    # ROC by trapezoids over tie groups
    tpr = np.concatenate([[0.0], tp / P])
    fpr = np.concatenate([[0.0], fp / N])
    auc = float(np.sum((fpr[1:] - fpr[:-1]) * (tpr[1:] + tpr[:-1]) / 2))
    precision = tp / np.maximum(tp + fp, 1e-12)
    recall = tp / P
    ap = float(np.sum(np.diff(np.concatenate([[0.0], recall])) * precision))
    return auc, ap


def roc_pr_with_intervals(table: pd.DataFrame, n_boot: int = 1000, seed: int = 0) -> dict:
    # -inf scores (the rule could not speak) stay at the bottom, tied.
    score = table.score.to_numpy()
    label = table.label.to_numpy()
    patients = table.patient_idx.to_numpy()
    n_p = int(patients.max()) + 1
    auc, ap = weighted_roc_pr(score, label, np.ones(len(score)))
    rng = np.random.default_rng(np.random.SeedSequence([seed, 123]))
    aucs, aps = [], []
    for _ in range(n_boot):
        counts = np.bincount(rng.integers(0, n_p, n_p), minlength=n_p).astype(float)
        a, p = weighted_roc_pr(score, label, counts[patients])
        aucs.append(a)
        aps.append(p)
    return {
        "auc": auc, "auc_lo": float(np.nanpercentile(aucs, 2.5)), "auc_hi": float(np.nanpercentile(aucs, 97.5)),
        "average_precision": ap, "ap_lo": float(np.nanpercentile(aps, 2.5)), "ap_hi": float(np.nanpercentile(aps, 97.5)),
        "positive_windows": int(label.sum()), "negative_windows": int((1 - label).sum()),
    }


def roc_curve_points(table: pd.DataFrame, max_points: int = 400):
    """(fpr, tpr, precision, recall) for plotting."""
    score = table.score.to_numpy()
    label = table.label.to_numpy()
    order = np.argsort(-score, kind="stable")
    s, y = score[order], label[order]
    new = np.ones(len(s), dtype=bool)
    new[1:] = s[1:] != s[:-1]
    gid = np.cumsum(new) - 1
    ng = gid[-1] + 1
    pos = np.bincount(gid, weights=y, minlength=ng)
    neg = np.bincount(gid, weights=1 - y, minlength=ng)
    tp, fp = np.cumsum(pos), np.cumsum(neg)
    P, N = tp[-1], fp[-1]
    tpr, fpr = np.concatenate([[0], tp / P]), np.concatenate([[0], fp / N])
    precision = tp / np.maximum(tp + fp, 1e-12)
    recall = tp / P
    keep = np.unique(np.linspace(0, ng - 1, min(max_points, ng)).astype(int))
    return fpr[np.concatenate([[0], keep + 1])], tpr[np.concatenate([[0], keep + 1])], precision[keep], recall[keep]
