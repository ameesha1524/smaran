"""Alert-rule comparison (Appendix C): which rule finds a real decline soonest, for how many false alarms?

Compares R0 absolute level, R1 single-session velocity, R2 two-consecutive velocity (the product default)
and R3 CUSUM, each with and without the confidence gate, against the simulator's ground truth.

Writes results/rules_*.csv and results/figures/rules_*.png. See rules.py for the definitions of
"pair", "fire", "episode", "delay" and "false alarm".
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

import rules as R
import scoring_core as sc
from common import COLORS, N_BOOT, fig_meta, get_cohort, params_from_env, save_figure, save_table
from replay import SequenceIndex, replay_frame

DECLINE_THRESHOLD = {"R0": -30.0, "R1": 1.5, "R2": 1.5, "R3": 4.0}  # the engine's "decline" level, and level <= 30
FAR_TARGETS = (0.5, 1.0, 2.0, 4.0, 8.0)  # false alarms per patient-year


class Setup:
    """A cohort replayed with and without the confidence gate, and the alarm scores of every rule on each."""

    def __init__(self, cohort):
        self.cohort = cohort
        self.truth = R.Truth.of(cohort)
        self.frames, self.index, self.scores = {}, {}, {}
        for gating, gate in (("on", sc.DEFAULT_CONFIG.confidence_gate), ("off", 0.0)):
            f = replay_frame(cohort.contributions, sc.DEFAULT_CONFIG.with_(confidence_gate=gate))
            idx = SequenceIndex.of(f)
            self.frames[gating], self.index[gating] = f, idx
            self.scores[gating] = {r: R.alarm_scores(f, idx, r) for r in R.RULES}

    def outcome(self, gating: str, rule: str, threshold: float) -> R.PerPatient:
        fires = self.scores[gating][rule] >= threshold
        return R.evaluate_fires(self.frames[gating], self.index[gating], fires, self.truth)


def default_operating_points(S: Setup, seed: int) -> pd.DataFrame:
    rows = []
    for level, thresholds in (("watch_or_worse", R.DEFAULT_THRESHOLD), ("decline_only", DECLINE_THRESHOLD)):
        for gating in ("on", "off"):
            for rule in R.RULES:
                pp = S.outcome(gating, rule, thresholds[rule])
                rows.append({"level": level, "gating": gating, "rule": rule, "name": R.RULE_NAMES[rule],
                             "threshold": thresholds[rule], **R.with_intervals(pp, N_BOOT, seed)})
    return pd.DataFrame(rows)


def by_trajectory(S: Setup, seed: int) -> pd.DataFrame:
    rows = []
    kinds = ["slow_decline", "fast_decline", "single_domain"]
    for rule in R.RULES:
        pp = S.outcome("on", rule, R.DEFAULT_THRESHOLD[rule])
        for kind in kinds:
            members = np.flatnonzero(S.truth.kind == kind)
            point = R.metrics(pp, members)
            rng = np.random.default_rng(np.random.SeedSequence([seed, 7]))
            boots = pd.DataFrame([R.metrics(pp, rng.choice(members, len(members))) for _ in range(N_BOOT)])
            row = {"rule": rule, "name": R.RULE_NAMES[rule], "trajectory": kind, "patients": len(members)}
            for k in ("sens_14d", "sens_30d", "sens_90d", "median_delay_days", "median_points_lost_at_detection"):
                lo, hi = np.nanpercentile(boots[k], [2.5, 97.5])
                row.update({k: point[k], f"{k}_lo": lo, f"{k}_hi": hi})
            rows.append(row)
    return pd.DataFrame(rows)


def low_scorers(S: Setup, seed: int) -> pd.DataFrame:
    """Does the absolute-level rule alarm on people who simply score low? (Appendix C: test, do not assume.)"""
    stable = np.flatnonzero(S.truth.kind == "stable")
    order = stable[np.argsort(S.truth.base_level[stable])]
    thirds = {"lowest third": order[: len(order) // 3], "middle third": order[len(order) // 3: 2 * len(order) // 3],
              "highest third": order[2 * len(order) // 3:]}
    rows = []
    for rule in R.RULES:
        pp = S.outcome("on", rule, R.DEFAULT_THRESHOLD[rule])
        for label, members in thirds.items():
            rng = np.random.default_rng(np.random.SeedSequence([seed, 8]))
            point = R.metrics(pp, members)["false_alarms_per_patient_year_stable"]
            boots = [R.metrics(pp, rng.choice(members, len(members)))["false_alarms_per_patient_year_stable"] for _ in range(N_BOOT)]
            lo, hi = np.nanpercentile(boots, [2.5, 97.5])
            rows.append({"rule": rule, "name": R.RULE_NAMES[rule], "stable_patients_scoring": label, "patients": len(members),
                         "mean_base_level": float(S.truth.base_level[members].mean()), "false_alarms_per_patient_year": point,
                         "lo": lo, "hi": hi})
    return pd.DataFrame(rows)


def sweeps(S: Setup) -> pd.DataFrame:
    rows = []
    for rule in R.RULES:
        for theta in R.SWEEP[rule]:
            m = R.metrics(S.outcome("on", rule, float(theta)))
            rows.append({"rule": rule, "threshold": float(theta), **m})
    return pd.DataFrame(rows)


def matched_far(S: Setup, sweep: pd.DataFrame, seed: int) -> pd.DataFrame:
    """At the same false-alarm rate, which rule is soonest? Each rule's most sensitive threshold within the budget."""
    rows = []
    for target in FAR_TARGETS:
        for rule in R.RULES:
            sw = sweep[(sweep.rule == rule) & (sweep.false_alarms_per_patient_year_stable <= target)]
            if sw.empty:
                rows.append({"false_alarms_per_patient_year_budget": target, "rule": rule, "name": R.RULE_NAMES[rule], "threshold": np.nan})
                continue
            best = sw.sort_values(["sens_90d", "sens_30d", "rmtd_90d"], ascending=[False, False, True]).iloc[0]
            pp = S.outcome("on", rule, float(best.threshold))
            rows.append({"false_alarms_per_patient_year_budget": target, "rule": rule, "name": R.RULE_NAMES[rule],
                         "threshold": float(best.threshold), **R.with_intervals(pp, N_BOOT, seed)})
    return pd.DataFrame(rows)


def roc_pr(S: Setup, seed: int):
    rows, curves = [], {}
    for gating in ("on", "off"):
        for rule in R.RULES:
            for horizon in (30, 90):
                table = R.window_table(S.frames[gating], S.index[gating], S.scores[gating][rule], S.truth, horizon=horizon)
                res = R.roc_pr_with_intervals(table, N_BOOT, seed)
                rows.append({"gating": gating, "rule": rule, "name": R.RULE_NAMES[rule], "horizon_days": horizon, **res})
                if gating == "on":
                    curves[(rule, horizon)] = R.roc_curve_points(table)
    return pd.DataFrame(rows), curves


# ------------------------------------------------------------------ figures


def figure_froc(sweep, defaults, p):
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.2))
    for ax, key, label in ((axes[0], "sens_30d", "Detected within 30 days of onset"),
                           (axes[1], "sens_90d", "Detected within 90 days of onset")):
        for rule in R.RULES:
            sw = sweep[sweep.rule == rule].sort_values("false_alarms_per_patient_year_stable")
            ax.plot(sw.false_alarms_per_patient_year_stable.clip(lower=0.05), sw[key], color=COLORS[rule], lw=1.8, label=R.RULE_NAMES[rule])
            d = defaults[(defaults.rule == rule) & (defaults.gating == "on") & (defaults.level == "watch_or_worse")].iloc[0]
            ax.scatter([max(d.false_alarms_per_patient_year_stable, 0.05)], [d[key]], color=COLORS[rule], s=46, zorder=5, edgecolor="white")
        ax.set_xscale("log")
        ax.set_xlabel("False alarms per patient-year (stable patients, 6 domains)")
        ax.set_ylabel(label)
        ax.set_ylim(-0.02, 1.02)
    axes[0].legend(loc="upper left")
    fig.suptitle("Sensitivity against false alarms, sweeping each rule's threshold. Dots mark the rule as shipped.", y=1.02)
    save_figure(fig, "rules_froc.png", fig_meta(p))


def figure_roc_pr(roc_table, curves, p):
    fig, axes = plt.subplots(2, 2, figsize=(10, 8))
    for col, horizon in enumerate((30, 90)):
        for rule in R.RULES:
            fpr, tpr, prec, rec = curves[(rule, horizon)]
            auc = roc_table[(roc_table.rule == rule) & (roc_table.horizon_days == horizon) & (roc_table.gating == "on")].iloc[0]
            axes[0, col].plot(fpr, tpr, color=COLORS[rule], label=f"{R.RULE_NAMES[rule]} (AUC {auc.auc:.2f})")
            axes[1, col].plot(rec, prec, color=COLORS[rule], label=f"{R.RULE_NAMES[rule]} (AP {auc.average_precision:.2f})")
        axes[0, col].plot([0, 1], [0, 1], color="#999", lw=0.8, ls="--")
        axes[0, col].set_title(f"ROC: windows ending within {horizon} days of a true onset")
        axes[0, col].set_xlabel("False positive rate (14-day windows)")
        axes[0, col].set_ylabel("True positive rate")
        axes[0, col].legend(loc="lower right")
        axes[1, col].set_title(f"Precision-recall: {horizon}-day horizon")
        axes[1, col].set_xlabel("Recall")
        axes[1, col].set_ylabel("Precision")
        axes[1, col].legend(loc="upper right")
    fig.suptitle("Window-level discrimination (confidence gate on)", y=1.0)
    fig.tight_layout()
    save_figure(fig, "rules_roc_pr.png", fig_meta(p))


def figure_delay_cdf(S, sweep, matched, p):
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.2), sharey=True)
    grid = np.arange(0, 181)

    def curve(pp):
        pairs = [x for lst in pp.pairs for x in lst if x[0] >= 180]
        d = np.array([x[1] for x in pairs])
        return np.array([(d <= w).mean() for w in grid]) if len(d) else np.full(len(grid), np.nan), len(d)

    budget = 2.0
    for ax, mode in ((axes[0], "shipped"), (axes[1], f"matched at {budget:g} false alarms per patient-year")):
        n = 0
        for rule in R.RULES:
            if mode == "shipped":
                theta = R.DEFAULT_THRESHOLD[rule]
            else:
                row = matched[(matched.rule == rule) & (matched.false_alarms_per_patient_year_budget == budget)].iloc[0]
                if np.isnan(row.threshold):
                    continue
                theta = row.threshold
            y, n = curve(S.outcome("on", rule, float(theta)))
            ax.plot(grid, y, color=COLORS[rule], label=R.RULE_NAMES[rule])
        ax.set_title(f"Rules {mode}")
        ax.set_xlabel("Days since the true onset")
        ax.text(0.02, 0.02, f"{n} declining patient-domains followed 180+ days", transform=ax.transAxes, fontsize=8, color="#555")
    axes[0].set_ylabel("Share detected by then")
    axes[0].legend(loc="upper left")
    fig.suptitle("How soon a real decline is caught", y=1.02)
    save_figure(fig, "rules_delay_cdf.png", fig_meta(p))


def figure_low_scorers(low, p):
    fig, ax = plt.subplots(figsize=(8, 4))
    labels = ["lowest third", "middle third", "highest third"]
    width = 0.2
    for k, rule in enumerate(R.RULES):
        sub = low[low.rule == rule].set_index("stable_patients_scoring").loc[labels]
        x = np.arange(3) + (k - 1.5) * width
        ax.bar(x, sub.false_alarms_per_patient_year, width, color=COLORS[rule], label=R.RULE_NAMES[rule],
               yerr=[sub.false_alarms_per_patient_year - sub.lo, sub.hi - sub.false_alarms_per_patient_year], error_kw={"lw": 0.8})
    ax.set_xticks(range(3))
    ax.set_xticklabels([f"{l}\n(level {low[low.stable_patients_scoring == l].mean_base_level.iloc[0]:.0f})" for l in labels])
    ax.set_ylabel("False alarms per patient-year")
    ax.set_title("Stable patients only: do the rules cry wolf on people who simply score low?")
    ax.legend()
    save_figure(fig, "rules_low_scorers.png", fig_meta(p))


def figure_example(S, p):
    """A stable patient who scores low, as each rule sees her."""
    low = np.flatnonzero(S.truth.kind == "stable")
    patient = int(low[np.argmin(S.truth.base_level[low])])
    f, idx = S.frames["on"], S.index["on"]
    sel = (f.patient_idx == patient) & (f.target == "EXECUTIVE")
    d = f[sel]
    fig, ax = plt.subplots(figsize=(10, 3.8))
    ax.scatter(d.day, d.raw, s=6, color="#bbb", label="session scores")
    ax.plot(d.day, d.level, color="#333", lw=1.4, label="level (EMA)")
    pos = np.flatnonzero(sel.to_numpy())
    for rule, y in (("R0", 4), ("R2", 10)):
        fires = (S.scores["on"][rule][pos] >= R.DEFAULT_THRESHOLD[rule])
        ax.scatter(d.day[fires], np.full(fires.sum(), y), marker="|", s=90, color=COLORS[rule], label=f"{R.RULE_NAMES[rule]} fires")
    ax.axhline(40, color=COLORS["R0"], lw=0.8, ls=":")
    ax.set_ylim(0, 100)
    ax.set_xlabel("Day")
    ax.set_ylabel("Executive score")
    ax.set_title(f"A stable patient whose usual is low (base level {S.truth.base_level[patient]:.0f}): nothing has changed")
    ax.legend(ncol=4, loc="upper right", fontsize=8)
    save_figure(fig, "rules_example_low_scorer.png", fig_meta(p, patient=patient))


def main() -> None:
    p = params_from_env()
    cohort = get_cohort(p)
    seed = p.seed
    print(f"alert-rule comparison: {p.n_patients} patients, {p.days} days, {N_BOOT} bootstrap resamples")
    S = Setup(cohort)

    defaults = default_operating_points(S, seed)
    save_table(defaults, "rules_default_operating_points.csv")
    save_table(by_trajectory(S, seed), "rules_by_trajectory.csv")
    low = low_scorers(S, seed)
    save_table(low, "rules_low_scorers.csv")
    sweep = sweeps(S)
    save_table(sweep, "rules_sweep.csv")
    matched = matched_far(S, sweep, seed)
    save_table(matched, "rules_matched_false_alarms.csv")
    roc_table, curves = roc_pr(S, seed)
    save_table(roc_table, "rules_roc_pr.csv")

    figure_froc(sweep, defaults, p)
    figure_roc_pr(roc_table, curves, p)
    figure_delay_cdf(S, sweep, matched, p)
    figure_low_scorers(low, p)
    figure_example(S, p)


if __name__ == "__main__":
    main()
