"""Practice effects: repetition raises scores, and that can hide a decline.

People get better at a game by playing it. If that rise is not modelled, a person whose ability has
started to fall can look as though she is holding steady (or improving) for as long as the rise lasts.

Three steps, each against ground truth:

  A  Estimate the practice curve from a *separate* reference cohort of stable patients, with a
     mixed-effects model (statsmodels): score ~ game + Pmax x (1 - exp(-k / tau)), a random intercept for each
     patient and domain, and k = how many times she has already played that game. tau is chosen by profile
     likelihood. The simulation's own values are known, so the estimate can be checked.
  B  In a cohort whose declines begin early, while practice is still accruing, estimate the trend in
     her scores with and without the practice term, and compare both with the true trend in her ability.
  C  Run the engine on the raw scores and on practice-adjusted scores and compare detection.

Writes results/practice_*.csv and results/figures/practice.png.
"""

from __future__ import annotations

import warnings
from dataclasses import replace

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.api as sm

import rules as R
import scoring_core as sc
import simulate
from common import COLORS, N_BOOT, fig_meta, get_cohort, params_from_env, save_figure, save_table
from params import SimParams
from replay import SequenceIndex, replay_frame

TAUS = (3, 5, 7, 10, 14, 20, 30)
DOMAIN_NUM = {d: i for i, d in enumerate(sc.DOMAIN_IDS)}


def with_practice_index(cohort) -> pd.DataFrame:
    c = cohort.contributions.merge(cohort.sessions[["session_idx", "practice_index"]], on="session_idx")
    c["group"] = c.patient_idx * 10 + c.target.map(DOMAIN_NUM)
    return c


def design(c: pd.DataFrame, tau: float | None, day: bool) -> pd.DataFrame:
    X = pd.get_dummies(c.game_id, drop_first=True, dtype=float)
    X.insert(0, "const", 1.0)
    if tau is not None:
        X["practice"] = 1 - np.exp(-c.practice_index.to_numpy() / tau)
    if day:
        X["day"] = c.day.to_numpy().astype(float)
    return X


def fit(c: pd.DataFrame, y: str, tau: float | None, day: bool):
    X = design(c, tau, day)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return sm.MixedLM(c[y].to_numpy(), X, groups=c.group.to_numpy()).fit(reml=False, method="lbfgs")


def estimate_curve(reference: pd.DataFrame) -> tuple[float, float, pd.DataFrame]:
    """Profile over tau; returns (pmax, tau, the profile table)."""
    rows = []
    for tau in TAUS:
        m = fit(reference, "raw", tau, day=False)
        rows.append({"tau": tau, "log_likelihood": float(m.llf), "pmax": float(m.params["practice"]),
                     "pmax_se": float(m.bse["practice"])})
    prof = pd.DataFrame(rows)
    best = prof.loc[prof.log_likelihood.idxmax()]
    return float(best.pmax), float(best.tau), prof


def adjust(c: pd.DataFrame, pmax: float, tau: float) -> pd.DataFrame:
    """Put every score on the scale of a fully practised player: add back what she had not yet gained."""
    out = c.copy()
    out["raw"] = np.clip(out.raw + pmax * np.exp(-out.practice_index / tau), 0, 100).round(1)
    return out


def detection(c: pd.DataFrame, cohort, seed: int, label: str) -> list[dict]:
    truth = R.Truth.of(cohort)
    frame = replay_frame(c[["patient_idx", "target", "session_idx", "day", "raw", "confidence"]])
    index = SequenceIndex.of(frame)
    rows = []
    for rule in ("R1", "R2", "R3"):
        score = R.alarm_scores(frame, index, rule)
        pp = R.evaluate_fires(frame, index, score >= R.DEFAULT_THRESHOLD[rule], truth)
        m = R.with_intervals(pp, N_BOOT, seed)
        table = R.window_table(frame, index, score, truth, horizon=90)
        roc = R.roc_pr_with_intervals(table, N_BOOT, seed)
        rows.append({"practice_modelled": label, "rule": rule, "name": R.RULE_NAMES[rule],
                     **{k: m[k] for k in m if k.split("_lo")[0].split("_hi")[0] in
                        ("sens_30d", "sens_90d", "rmtd_90d", "median_delay_days", "false_alarms_per_patient_year_stable")},
                     "auc_90d_horizon": roc["auc"], "auc_90d_lo": roc["auc_lo"], "auc_90d_hi": roc["auc_hi"]})
    return rows


def main() -> None:
    p = params_from_env()
    small = p.n_patients < 100
    ref_params = replace(p, seed=p.seed + 1, n_patients=40 if small else 80, p_stable=1.0, p_slow_decline=0.0,
                         p_fast_decline=0.0, p_single_domain=0.0, p_improving=0.0)
    early_params = replace(p, seed=p.seed + 2, n_patients=40 if small else 120, p_stable=0.4, p_slow_decline=0.6,
                           p_fast_decline=0.0, p_single_domain=0.0, p_improving=0.0, onset_min_day=10, onset_max_day=30,
                           days=min(p.days, 240))
    print("practice effects: reference cohort", ref_params.n_patients, "early-onset cohort", early_params.n_patients)

    # ---- A: the curve ----------------------------------------------------------------
    ref = with_practice_index(get_cohort(ref_params))
    ref = ref[ref.is_primary & ref.completed]
    pmax, tau, profile = estimate_curve(ref)
    truth_tau = float(np.exp(np.mean(np.log([p.practice_tau_median]))))
    profile["simulated_pmax_mean"] = p.practice_max_mean
    profile["simulated_tau_median"] = truth_tau
    save_table(profile, "practice_curve_fit.csv")
    print(f"  estimated practice: pmax {pmax:.1f} (simulated mean {p.practice_max_mean}), tau {tau} (simulated median {truth_tau})")

    # ---- B: masking ---------------------------------------------------------------------
    cohort = get_cohort(early_params)
    c = with_practice_index(cohort)
    kinds = cohort.patients.set_index("patient_idx").trajectory
    dec = c[c.patient_idx.map(kinds) == "slow_decline"]
    dec = dec[dec.is_primary & dec.completed & (dec.day <= 150)]
    rows = []
    for name, tau_arg, y in (("true ability (simulation)", None, "latent"),
                             ("scores, practice ignored", None, "raw"),
                             ("scores, practice modelled", tau, "raw")):
        m = fit(dec, y, tau_arg, day=True)
        slope = float(m.params["day"])
        lo, hi = m.conf_int().loc["day"]
        rows.append({"model": name, "points_per_day": slope, "lo": float(lo), "hi": float(hi),
                     "points_per_30_days": slope * 30})
    masking = pd.DataFrame(rows)
    save_table(masking, "practice_masking.csv")
    print(masking.round(3).to_string(index=False))

    # ---- C: detection ---------------------------------------------------------------------
    raw_c = c
    adj_c = adjust(c, pmax, tau)
    det = pd.DataFrame(detection(raw_c, cohort, p.seed, "no") + detection(adj_c, cohort, p.seed, "yes"))
    det["scenario"] = "decline begins while she is still learning (onset day 10 to 30)"
    main_cohort = get_cohort(p)
    mc = with_practice_index(main_cohort)
    det2 = pd.DataFrame(detection(mc, main_cohort, p.seed, "no") + detection(adjust(mc, pmax, tau), main_cohort, p.seed, "yes"))
    det2["scenario"] = "main cohort (onset day 60 to 200, practice mostly settled)"
    det = pd.concat([det, det2], ignore_index=True)
    save_table(det, "practice_detection.csv")

    # ---- figure ----------------------------------------------------------------------------
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.2))
    ax = axes[0]
    ks = np.arange(0, 60)
    mean_by_k = ref.groupby("practice_index").raw.mean()
    mean_by_k = mean_by_k[mean_by_k.index < 60]
    ax.scatter(mean_by_k.index, mean_by_k.values - mean_by_k.values[-20:].mean(), s=10, color="#999",
               label="stable patients (mean score, centred)")
    ax.plot(ks, pmax * (1 - np.exp(-ks / tau)) - pmax * (1 - np.exp(-np.arange(40, 60) / tau)).mean(), color=COLORS["R2"],
            label=f"fitted: {pmax:.1f} x (1 - exp(-k/{tau:g}))")
    ax.set_xlabel("Times she has already played that game (k)")
    ax.set_ylabel("Score relative to well-practised")
    ax.set_title("A. The practice curve, recovered")
    ax.legend(fontsize=8)

    ax = axes[1]
    d_all = c[(c.patient_idx.map(kinds) == "slow_decline") & c.is_primary & c.completed]
    g = d_all.groupby(d_all.day // 10 * 10)[["raw", "latent"]].mean()
    g = g[g.index <= 180]
    ax.plot(g.index, g.latent, color="#333", lw=2, label="true ability")
    ax.plot(g.index, g.raw, color=COLORS["R1"], lw=2, label="what the games saw")
    ax.set_xlabel("Day")
    ax.set_ylabel("Mean score of early-onset decliners")
    ax.set_title("B. Her scores rise while her ability falls")
    ax.legend()

    ax = axes[2]
    pivot = det[det.scenario.str.startswith("decline begins")].pivot(index="name", columns="practice_modelled", values="sens_90d")
    x = np.arange(len(pivot))
    ax.bar(x - 0.2, pivot["no"], 0.4, color="#bbb", label="practice ignored")
    ax.bar(x + 0.2, pivot["yes"], 0.4, color=COLORS["R2"], label="practice modelled")
    ax.set_xticks(x)
    ax.set_xticklabels(pivot.index, fontsize=8)
    ax.set_ylabel("Detected within 90 days")
    ax.set_title("C. Detection with and without the practice curve")
    ax.legend()
    save_figure(fig, "practice.png", fig_meta(p, pmax_hat=pmax, tau_hat=tau))


if __name__ == "__main__":
    main()
