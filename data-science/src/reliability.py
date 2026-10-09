"""Test-retest reliability on simulated patients whose ability does not change.

If nothing about a person changes, how closely does the score she gets now match the score she gets
next time? An ICC near 1 means differences between people are real and stable; near 0, a score
is mostly noise. Three things are measured, all on the `stable` patients only, in the stretch after the
practice effect has mostly settled (days 90 to 149):

  single      one session's score against the next session's, same domain
  average     the mean of seven sessions in days 90-119 against the mean of seven in 120-149
  level       the engine's own level (the number the dashboard shows) at day 119 against day 149

ICC(2,1) asks for absolute agreement, ICC(3,1) for consistency (a shared shift between the two occasions,
such as a good fortnight, is not counted against it). Shrout and Fleiss (1979), two-way models.
Intervals come from a patient-level bootstrap. The Spearman-Brown column predicts the averaged ICC from
the single one, a check that the pieces agree.

Writes results/reliability.csv and results/figures/reliability.png.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

import scoring_core as sc
from common import COLORS, N_BOOT, fig_meta, get_cohort, params_from_env, save_figure, save_table
from replay import replay_frame

WINDOW_A = (90, 120)
WINDOW_B = (120, 150)
K_AVERAGE = 7


def icc(x: np.ndarray) -> dict:
    """Shrout and Fleiss ICC(1,1), ICC(2,1), ICC(3,1) for an n x k matrix (n subjects, k occasions)."""
    x = np.asarray(x, dtype=float)
    n, k = x.shape
    grand = x.mean()
    ss_total = ((x - grand) ** 2).sum()
    ss_rows = k * ((x.mean(axis=1) - grand) ** 2).sum()
    ss_cols = n * ((x.mean(axis=0) - grand) ** 2).sum()
    ss_err = ss_total - ss_rows - ss_cols
    msr = ss_rows / (n - 1)
    msc = ss_cols / (k - 1)
    mse = ss_err / ((n - 1) * (k - 1))
    msw = (ss_cols + ss_err) / (n * (k - 1))
    return {
        "icc1": (msr - msw) / (msr + (k - 1) * msw),
        "icc21": (msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n),
        "icc31": (msr - mse) / (msr + (k - 1) * mse),
    }


def spearman_brown(r: float, k: int) -> float:
    return k * r / (1 + (k - 1) * r)


def collect(cohort, frame) -> dict:
    """One row per (stable patient, domain) with the three kinds of paired measurements, or NaN when it has too few sessions."""
    stable = set(cohort.patients[cohort.patients.trajectory == "stable"].patient_idx)
    c = cohort.contributions
    c = c[c.patient_idx.isin(stable) & c.completed]
    rows = []
    levels = frame[frame.patient_idx.isin(stable)]
    for (patient, domain), g in c.groupby(["patient_idx", "target"], sort=True):
        if domain not in sc.DOMAIN_IDS:
            continue
        g = g.sort_values("session_idx")
        a = g[(g.day >= WINDOW_A[0]) & (g.day < WINDOW_A[1])].raw.to_numpy()
        b = g[(g.day >= WINDOW_B[0]) & (g.day < WINDOW_B[1])].raw.to_numpy()
        lv = levels[(levels.patient_idx == patient) & (levels.target == domain)]
        la = lv[lv.day < WINDOW_A[1]].level.to_numpy()
        lb = lv[lv.day < WINDOW_B[1]].level.to_numpy()
        rows.append(
            dict(
                patient=patient, domain=domain,
                s1=a[0] if len(a) >= 2 else np.nan, s2=a[1] if len(a) >= 2 else np.nan,
                avg_a=a[:K_AVERAGE].mean() if len(a) >= K_AVERAGE else np.nan,
                avg_b=b[:K_AVERAGE].mean() if len(b) >= K_AVERAGE else np.nan,
                lvl_a=la[-1] if len(la) else np.nan, lvl_b=lb[-1] if len(lb) else np.nan,
            )
        )
    return pd.DataFrame(rows)


def one_estimate(d: pd.DataFrame, pair: tuple) -> dict:
    sub = d[list(pair)].dropna()
    return {**icc(sub.to_numpy()), "n": len(sub)}


def main() -> None:
    p = params_from_env()
    cohort = get_cohort(p)
    frame = replay_frame(cohort.contributions)
    d = collect(cohort, frame)
    rng = np.random.default_rng(np.random.SeedSequence([p.seed, 31]))
    patients = d.patient.unique()
    by_patient = {k: g for k, g in d.groupby("patient")}
    measures = {"single": ("s1", "s2"), "average": ("avg_a", "avg_b"), "level": ("lvl_a", "lvl_b")}
    print(f"reliability: {len(patients)} stable patients, {len(d)} patient-domains")

    rows = []
    boot_samples = [pd.concat([by_patient[k] for k in rng.choice(patients, len(patients))]) for _ in range(N_BOOT)]
    for scope in ["all domains"] + list(sc.DOMAIN_IDS):
        base = d if scope == "all domains" else d[d.domain == scope]
        boots = boot_samples if scope == "all domains" else [b[b.domain == scope] for b in boot_samples]
        for name, pair in measures.items():
            est = one_estimate(base, pair)
            draws = {k: [] for k in ("icc21", "icc31")}
            for b in boots:
                e = one_estimate(b, pair)
                for k in draws:
                    draws[k].append(e[k])
            rows.append(
                {"scope": scope, "measure": name, "n_subjects": est["n"], "icc_2_1": est["icc21"],
                 "icc_2_1_lo": np.nanpercentile(draws["icc21"], 2.5), "icc_2_1_hi": np.nanpercentile(draws["icc21"], 97.5),
                 "icc_3_1": est["icc31"], "icc_3_1_lo": np.nanpercentile(draws["icc31"], 2.5),
                 "icc_3_1_hi": np.nanpercentile(draws["icc31"], 97.5)}
            )
    table = pd.DataFrame(rows)
    single = table[(table.scope == "all domains") & (table.measure == "single")].icc_3_1.iloc[0]
    table["spearman_brown_prediction_for_7_sessions"] = np.where(
        table.measure == "average", spearman_brown(single, K_AVERAGE), np.nan
    )
    save_table(table, "reliability.csv")

    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    for ax, (name, pair), col in zip(axes, measures.items(), (COLORS["R1"], COLORS["R2"], COLORS["R3"])):
        sub = d[list(pair)].dropna()
        ax.scatter(sub[pair[0]], sub[pair[1]], s=8, alpha=0.5, color=col)
        lim = [min(sub.min()) - 3, max(sub.max()) + 3]
        ax.plot(lim, lim, color="#888", lw=0.8)
        r = table[(table.scope == "all domains") & (table.measure == name)].iloc[0]
        ax.set_title(f"{name}: ICC(2,1) {r.icc_2_1:.2f} ({r.icc_2_1_lo:.2f} to {r.icc_2_1_hi:.2f})")
        ax.set_xlabel("first occasion")
        ax.set_ylabel("second occasion")
    fig.suptitle("Test-retest on stable simulated patients (one point per patient and domain)", y=1.02)
    save_figure(fig, "reliability.png", fig_meta(p, windows=[WINDOW_A, WINDOW_B], k_average=K_AVERAGE))


if __name__ == "__main__":
    main()
