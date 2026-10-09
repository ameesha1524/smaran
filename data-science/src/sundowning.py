"""Sundowning detection: is she doing worse in the late afternoon than in the morning?

A Python port of backend/.../scoring/SundowningDetector.java (the rule the server runs), held to the same
shared vectors (sundowning-vectors.json, tests on both sides), and then *evaluated* against the simulator's
ground truth, which knows which patients have a late-day dip and how big it is.

The rule: over the last 30 days, take each sitting's score relative to the average for its own game; compare
the sittings that began 06:00-11:59 with those that began 15:00-19:59; Cohen's d of the gap (pooled SD, floored
at 3 points); flag at d >= 0.8; nothing is said until there are at least 6 sittings in each part.

Writes results/sundowning_*.csv and results/figures/sundowning.png.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

import rules as R
import simulate
from common import COLORS, N_BOOT, fig_meta, get_cohort, params_from_env, save_figure, save_table

MIN_PER_PART = 6
FLAG_AT = 0.8
END_BELOW = 0.5
MIN_SPREAD = 3.0
WINDOW_DAYS = 30


@dataclass(frozen=True)
class Verdict:
    enough_data: bool
    effect_size: float
    morning: int
    late_afternoon: int

    def flagged(self, flag_at: float = FLAG_AT) -> bool:
        return self.enough_data and self.effect_size >= flag_at


def is_morning(hour: int) -> bool:
    return 6 <= hour <= 11


def is_late_afternoon(hour: int) -> bool:
    return 15 <= hour <= 19


def _mean(xs):
    s = 0.0
    for x in xs:
        s += x
    return s / len(xs)


def _variance(xs, m):
    if len(xs) < 2:
        return 0.0
    ss = 0.0
    for x in xs:
        ss += (x - m) * (x - m)
    return ss / (len(xs) - 1)


def evaluate(sittings, min_per_part: int = MIN_PER_PART) -> Verdict:
    """sittings: iterable of (game_id, hour, score). Same arithmetic, in the same order, as the Java."""
    sittings = list(sittings)
    totals: dict = {}
    for game, _, score in sittings:
        acc = totals.setdefault(game, [0.0, 0])
        acc[0] += score
        acc[1] += 1
    morning, late = [], []
    for game, hour, score in sittings:
        total, n = totals[game]
        relative = score - total / n
        if is_morning(hour):
            morning.append(relative)
        elif is_late_afternoon(hour):
            late.append(relative)
    if len(morning) < min_per_part or len(late) < min_per_part:
        return Verdict(False, 0.0, len(morning), len(late))
    m, l = _mean(morning), _mean(late)
    pooled = math.sqrt(((len(morning) - 1) * _variance(morning, m) + (len(late) - 1) * _variance(late, l))
                       / (len(morning) + len(late) - 2))
    return Verdict(True, (m - l) / max(MIN_SPREAD, pooled), len(morning), len(late))


# ----------------------------------------------------------------- the evaluation


def sitting_scores(cohort) -> pd.DataFrame:
    """One row per session: the confidence-weighted mean of its contributions, as AlertService computes it."""
    c = cohort.contributions
    g = c.assign(w=c.raw * c.confidence).groupby("session_idx").agg(w=("w", "sum"), conf=("confidence", "sum"))
    s = cohort.sessions.set_index("session_idx").join(g)
    s["score"] = s.w / s.conf
    return s.reset_index()[["session_idx", "patient_idx", "day", "hour", "game_id", "score"]]


def evaluations(cohort, step: int = 7, min_per_part: int = MIN_PER_PART) -> pd.DataFrame:
    """Evaluate every patient every `step` days from day 30, over the 30 days before, as the server would."""
    s = sitting_scores(cohort)
    truth = cohort.patients.set_index("patient_idx")
    rows = []
    for patient, g in s.groupby("patient_idx"):
        days = g.day.to_numpy()
        hours = g.hour.to_numpy()
        games = g.game_id.to_numpy()
        scores = g.score.to_numpy()
        last = int(days.max())
        for t in range(WINDOW_DAYS, last + 1, step):
            sel = (days > t - WINDOW_DAYS) & (days <= t)
            v = evaluate(zip(games[sel], hours[sel], scores[sel]), min_per_part)
            rows.append({"patient_idx": patient, "day": t, "enough_data": v.enough_data,
                         "d": v.effect_size if v.enough_data else np.nan, "n_morning": v.morning, "n_late": v.late_afternoon})
    e = pd.DataFrame(rows)
    e["sundowner"] = e.patient_idx.map(truth.sundowner).astype(bool)
    e["dip_points"] = e.patient_idx.map(truth.sundown_points)
    e["trajectory"] = e.patient_idx.map(truth.trajectory)
    return e


def wilson(k: int, n: int, z: float = 1.96) -> tuple:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (centre - half, centre + half)


def summarise(e: pd.DataFrame, flag_at: float = FLAG_AT) -> dict:
    flagged = e.enough_data & (e.d >= flag_at)
    per_patient = e.assign(flagged=flagged).groupby("patient_idx").agg(
        ever=("flagged", "max"), sundowner=("sundowner", "first"), evaluable=("enough_data", "max"))
    out = {}
    for label, sel in (("sundowner", e.sundowner), ("not_sundowner", ~e.sundowner)):
        ev = e[sel & e.enough_data]
        k = int((flagged & sel).sum())
        n = len(ev)
        lo, hi = wilson(k, n)
        out[f"evaluation_flag_rate_{label}"] = k / n if n else float("nan")
        out[f"evaluation_flag_rate_{label}_lo"], out[f"evaluation_flag_rate_{label}_hi"] = lo, hi
        pp = per_patient[(per_patient.sundowner == (label == "sundowner")) & per_patient.evaluable]
        k2, n2 = int(pp.ever.sum()), len(pp)
        lo2, hi2 = wilson(k2, n2)
        out[f"patients_ever_flagged_{label}"] = k2 / n2 if n2 else float("nan")
        out[f"patients_ever_flagged_{label}_lo"], out[f"patients_ever_flagged_{label}_hi"] = lo2, hi2
        out[f"patients_{label}"] = n2
    ev_all = e[e.enough_data]
    out["share_of_evaluations_with_enough_data"] = float(e.enough_data.mean())
    out["median_d_sundowners"] = float(ev_all[ev_all.sundowner].d.median())
    out["median_d_others"] = float(ev_all[~ev_all.sundowner].d.median())
    return out


def auc_with_ci(e: pd.DataFrame, seed: int) -> dict:
    ev = e[e.enough_data]
    score = ev.d.to_numpy()
    label = ev.sundowner.to_numpy().astype(int)
    patients = ev.patient_idx.to_numpy()
    ids, inv = np.unique(patients, return_inverse=True)
    auc, ap = R.weighted_roc_pr(score, label, np.ones(len(score)))
    rng = np.random.default_rng(np.random.SeedSequence([seed, 41]))
    aucs = []
    for _ in range(N_BOOT):
        counts = np.bincount(rng.integers(0, len(ids), len(ids)), minlength=len(ids)).astype(float)
        aucs.append(R.weighted_roc_pr(score, label, counts[inv])[0])
    return {"auc": auc, "auc_lo": float(np.nanpercentile(aucs, 2.5)), "auc_hi": float(np.nanpercentile(aucs, 97.5)),
            "average_precision": ap}


def main() -> None:
    p = params_from_env()
    cohort = get_cohort(p)
    print(f"sundowning: {p.n_patients} patients, {int(cohort.patients.sundowner.sum())} with a late-day dip")
    e = evaluations(cohort)
    main_row = {"setting": "shipped (d >= 0.8, 6 sittings per part)", **summarise(e), **auc_with_ci(e, p.seed)}
    save_table(pd.DataFrame([main_row]), "sundowning_summary.csv")

    # ---- the guard and the threshold -------------------------------------------------
    rows = []
    for n_min in (3, 6, 10, 15):
        en = evaluations(cohort, min_per_part=n_min)
        for flag in (0.5, 0.8, 1.2):
            rows.append({"min_sittings_per_part": n_min, "flag_at_d": flag, **summarise(en, flag)})
    save_table(pd.DataFrame(rows), "sundowning_guard_and_threshold.csv")

    # ---- by trajectory (does decline look like a late-day dip?) ---------------------------
    flagged = e.enough_data & (e.d >= FLAG_AT)
    traj = (e[~e.sundowner].assign(flagged=flagged[~e.sundowner]).query("enough_data")
            .groupby("trajectory").agg(evaluations=("flagged", "size"), flag_rate=("flagged", "mean")).reset_index())
    save_table(traj, "sundowning_false_flags_by_trajectory.csv")

    # ---- power: how big must the dip be? ----------------------------------------------------
    rows = []
    n_power = 30 if p.n_patients < 100 else 60
    for dip in (0, 2, 4, 6, 8, 10, 14):
        q = replace(p, seed=p.seed + 100 + dip, n_patients=n_power, days=min(p.days, 240), p_stable=1.0, p_slow_decline=0.0,
                    p_fast_decline=0.0, p_single_domain=0.0, p_improving=0.0, sundowner_share=1.0 if dip else 0.0,
                    sundown_lo=float(dip), sundown_hi=float(dip) + 1e-9, dropout_share=0.0)
        c = simulate.simulate(q)
        en = evaluations(c)
        sm = summarise(en)
        key = "sundowner" if dip else "not_sundowner"
        rows.append({"dip_points": dip, "evaluation_flag_rate": sm[f"evaluation_flag_rate_{key}"],
                     "lo": sm[f"evaluation_flag_rate_{key}_lo"], "hi": sm[f"evaluation_flag_rate_{key}_hi"],
                     "patients_ever_flagged": sm[f"patients_ever_flagged_{key}"], "median_d": float(en[en.enough_data].d.median())})
    power = pd.DataFrame(rows)
    save_table(power, "sundowning_power.csv")

    # ---- figure -----------------------------------------------------------------------------
    fig, axes = plt.subplots(1, 3, figsize=(14, 4))
    ev = e[e.enough_data]
    ax = axes[0]
    bins = np.linspace(-1.5, 3.5, 40)
    ax.hist(ev[~ev.sundowner].d, bins=bins, alpha=0.7, color="#999", label="no late-day dip", density=True)
    ax.hist(ev[ev.sundowner].d, bins=bins, alpha=0.7, color=COLORS["R1"], label="late-day dip", density=True)
    ax.axvline(FLAG_AT, color="#333", ls="--", lw=1)
    ax.set_xlabel("Effect size d (morning minus late afternoon)")
    ax.set_ylabel("Density")
    ax.set_title("A. What the detector sees")
    ax.legend()

    ax = axes[1]
    ax.errorbar(power.dip_points, power.evaluation_flag_rate, yerr=[power.evaluation_flag_rate - power.lo, power.hi - power.evaluation_flag_rate],
                fmt="o-", color=COLORS["R2"], label="share of weekly evaluations flagged")
    ax.plot(power.dip_points, power.patients_ever_flagged, "s--", color=COLORS["R3"], label="patients flagged at least once")
    ax.set_xlabel("True late-afternoon dip (points)")
    ax.set_ylabel("Share")
    ax.set_title("B. How big a dip is found")
    ax.legend(fontsize=8)

    ax = axes[2]
    thr = np.linspace(-0.5, 3.0, 60)
    tpr = [(ev[ev.sundowner].d >= t).mean() for t in thr]
    fpr = [(ev[~ev.sundowner].d >= t).mean() for t in thr]
    ax.plot(fpr, tpr, color=COLORS["R2"])
    ax.scatter([(ev[~ev.sundowner].d >= FLAG_AT).mean()], [(ev[ev.sundowner].d >= FLAG_AT).mean()], color="#333", zorder=5, label="d = 0.8 (shipped)")
    ax.plot([0, 1], [0, 1], color="#999", lw=0.8, ls="--")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title(f"C. ROC over d (AUC {main_row['auc']:.2f})")
    ax.legend()
    save_figure(fig, "sundowning.png", fig_meta(p))


if __name__ == "__main__":
    main()
