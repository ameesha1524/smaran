"""Ablations: which of the engine's settings matter, and which do not.

  gating   the confidence gate (0 = off, 0.35 = shipped), and what it is for: the first weeks
  alpha    the EMA weight. It sets the displayed level and the absolute-level rule; it cannot
           touch a velocity rule, because the baseline is the mean of raw scores (shown, not assumed)
  prior_sd the SD used before there are five readings
  min_sd   the floor on the SD
  window   how many past scores the baseline looks back over
  abandoned  what happens if a session she left part-way is allowed to count toward alerts, or not

Each variant is a full replay of the cohort with that one setting changed, judged by the same
metrics as the rule comparison (rules.py), at each rule's shipped threshold, with patient-level
bootstrap intervals. Writes results/ablation_*.csv and results/figures/ablations.png.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

import rules as R
import simulate
import scoring_core as sc
from common import COLORS, N_BOOT, fig_meta, get_cohort, params_from_env, save_figure, save_table
from replay import SequenceIndex, replay_frame

KEYS = ("sens_30d", "sens_90d", "rmtd_90d", "median_delay_days", "false_alarms_per_patient_year_stable",
        "warmup_false_alarms_per_stable_patient")


def variant(cohort, truth, config: sc.ScoringConfig, rule_list, seed) -> list[dict]:
    frame = replay_frame(cohort.contributions, config)
    index = SequenceIndex.of(frame)
    out = []
    for rule in rule_list:
        score = R.alarm_scores(frame, index, rule)
        pp = R.evaluate_fires(frame, index, score >= R.DEFAULT_THRESHOLD[rule], truth)
        full = R.with_intervals(pp, N_BOOT, seed)
        out.append({"rule": rule, **{k: full[k] for k in full if any(k.startswith(x) for x in KEYS)}})
    return out


def level_error(cohort, truth, config: sc.ScoringConfig) -> dict:
    """How close the displayed level sits to what the games were actually seeing (ability + practice + bias is not
    knowable, so the yardstick is the latent ability plus the session mean offset); lower is a better tracker."""
    frame = replay_frame(cohort.contributions, config)
    domain = frame.target.map({d: i for i, d in enumerate(sc.DOMAIN_IDS)}).to_numpy()
    mask = ~frame.gated.to_numpy() & (domain >= 0)
    lat = truth.latent[frame.patient_idx.to_numpy(), frame.day.to_numpy(), domain.clip(0)]
    err = frame.level.to_numpy() - lat
    kind = truth.kind[frame.patient_idx.to_numpy()]
    out = {}
    for label, sel in (("stable", kind == "stable"), ("declining", np.isin(kind, ["slow_decline", "fast_decline", "single_domain"]))):
        e = err[mask & sel]
        # remove the constant offset every setting shares (practice and game difficulty) so settings compare on tracking
        out[f"level_rmse_{label}"] = float(np.sqrt(np.mean((e - np.median(e)) ** 2)))
    # lag after onset for declining pairs: level minus latent, mean over the 60 days after onset
    onset = np.array([truth.onset.get((int(p), t), np.nan) for p, t in zip(frame.patient_idx.to_numpy(), frame.target.to_numpy())])
    dec = np.array([truth.direction.get((int(p), t), 0) < 0 for p, t in zip(frame.patient_idx.to_numpy(), frame.target.to_numpy())])
    after = dec & (frame.day.to_numpy() >= onset) & (frame.day.to_numpy() <= onset + 90)
    before = dec & (frame.day.to_numpy() < onset) & (frame.day.to_numpy() >= onset - 30)
    out["level_minus_latent_before_onset"] = float(np.mean(err[before & mask])) if (before & mask).any() else float("nan")
    out["level_minus_latent_90d_after_onset"] = float(np.mean(err[after & mask])) if (after & mask).any() else float("nan")
    return out


def main() -> None:
    p = params_from_env()
    cohort = get_cohort(p)
    truth = R.Truth.of(cohort)
    seed = p.seed
    base = sc.DEFAULT_CONFIG
    vel = ("R1", "R2", "R3")
    print(f"ablations: {p.n_patients} patients")

    # ---- the confidence gate --------------------------------------------------
    rows = []
    for gate in (0.0, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0):
        first = int(np.ceil(gate * base.full_confidence_observations - 1e-12)) if gate else 0
        for r in variant(cohort, truth, base.with_(confidence_gate=gate), vel, seed):
            rows.append({"ablation": "confidence_gate", "setting": gate, "readings_before_alerts_allowed": first, **r})
    gate_df = pd.DataFrame(rows)
    save_table(gate_df, "ablation_gate.csv")

    # ---- the EMA weight ---------------------------------------------------------
    rows = []
    for alpha in (0.05, 0.10, 0.25, 0.40, 0.60, 0.90):
        cfg = base.with_(base_alpha=alpha)
        err = level_error(cohort, truth, cfg)
        for r in variant(cohort, truth, cfg, ("R0",) + vel, seed):
            rows.append({"ablation": "base_alpha", "setting": alpha, **err, **r})
    alpha_df = pd.DataFrame(rows)
    save_table(alpha_df, "ablation_alpha.csv")

    # ---- the prior SD and the SD floor ------------------------------------------
    rows = []
    for gate in (0.35, 0.0):
        for prior in (4.0, 8.0, 12.0, 16.0, 24.0):
            for r in variant(cohort, truth, base.with_(prior_sd=prior, confidence_gate=gate), ("R2",), seed):
                rows.append({"ablation": "prior_sd", "gate": gate, "setting": prior, **r})
    prior_df = pd.DataFrame(rows)
    save_table(prior_df, "ablation_prior_sd.csv")

    rows = []
    for floor in (0.5, 1.5, 3.0, 6.0, 9.0):
        for r in variant(cohort, truth, base.with_(min_sd=floor), vel, seed):
            rows.append({"ablation": "min_sd", "setting": floor, **r})
    floor_df = pd.DataFrame(rows)
    save_table(floor_df, "ablation_min_sd.csv")

    # ---- the baseline window ------------------------------------------------------
    rows = []
    for window in (8, 15, 30, 60, 120):
        for r in variant(cohort, truth, base.with_(window=window), vel, seed):
            rows.append({"ablation": "window", "setting": window, **r})
    window_df = pd.DataFrame(rows)
    save_table(window_df, "ablation_window.csv")

    # ---- sessions she left part-way ---------------------------------------------------
    # The engine's alert rules see a short or abandoned session's score at full weight (only the level, through alpha,
    # is damped by confidence). Here such sessions are simply not shown to the engine, to see what they cost.
    c = cohort.contributions
    rows = []
    for label, keep in (("all sessions (as shipped)", np.ones(len(c), dtype=bool)),
                        ("finished sessions only", ~c.abandoned.to_numpy()),
                        ("confidence at least 0.5", c.confidence.to_numpy() >= 0.5),
                        ("confidence at least 0.7", c.confidence.to_numpy() >= 0.7)):
        sub = simulate.Cohort(cohort.params, cohort.patients, cohort.truth, cohort.sessions, c[keep], cohort.latent)
        for r in variant(sub, truth, base, vel, seed):
            rows.append({"ablation": "left_sessions", "setting": label, "contributions_kept": float(keep.mean()), **r})
    left_df = pd.DataFrame(rows)
    save_table(left_df, "ablation_left_sessions.csv")

    # ---- the figure ----------------------------------------------------------------
    fig, axes = plt.subplots(2, 4, figsize=(17, 7))

    ax = axes[0, 0]
    for rule in vel:
        d = gate_df[gate_df.rule == rule]
        ax.plot(d.setting, d.warmup_false_alarms_per_stable_patient, "o-", color=COLORS[rule], label=R.RULE_NAMES[rule])
    ax.axvline(0.35, color="#999", ls="--", lw=0.8)
    ax.set_xlabel("Confidence gate")
    ax.set_ylabel(f"False alarms in a stable patient's first {R.WARMUP_DAYS} days")
    ax.set_title("Gate: what it buys is quiet in the first weeks")
    ax.legend()

    ax = axes[0, 1]
    for rule in vel:
        d = gate_df[gate_df.rule == rule]
        ax.plot(d.setting, d.sens_90d, "o-", color=COLORS[rule])
    ax.axvline(0.35, color="#999", ls="--", lw=0.8)
    ax.set_xlabel("Confidence gate")
    ax.set_ylabel("Detected within 90 days")
    ax.set_title("Gate: and what it costs")

    ax = axes[0, 2]
    d0 = alpha_df[alpha_df.rule == "R0"]
    ax.plot(d0.setting, d0.level_rmse_stable, "o-", color="#333", label="stable patients")
    ax.plot(d0.setting, d0.level_rmse_declining, "s-", color="#c4572d", label="declining patients")
    ax.set_xscale("log")
    ax.set_xlabel("EMA weight (alpha)")
    ax.set_ylabel("Spread of (level - true ability), points")
    ax.set_title("Alpha: a smoother level or a faster one")
    ax.legend()

    ax = axes[1, 0]
    for rule in ("R0",) + vel:
        d = alpha_df[alpha_df.rule == rule]
        ax.plot(d.setting, d.sens_90d, "o-", color=COLORS[rule], label=R.RULE_NAMES[rule])
    ax.set_xscale("log")
    ax.set_xlabel("EMA weight (alpha)")
    ax.set_ylabel("Detected within 90 days")
    ax.set_title("Alpha moves only the absolute-level rule")
    ax.legend(fontsize=7)

    ax = axes[1, 1]
    for gate, style in ((0.35, "-"), (0.0, "--")):
        d = prior_df[prior_df.gate == gate]
        ax.plot(d.setting, d.warmup_false_alarms_per_stable_patient, "o" + style, color=COLORS["R2"], label=f"gate {gate}")
    ax.set_xlabel("Prior SD")
    ax.set_ylabel("Warm-up false alarms per stable patient (R2)")
    ax.set_title("Prior SD matters only where the gate is open")
    ax.legend()

    ax = axes[1, 2]
    for rule in vel:
        d = window_df[window_df.rule == rule]
        ax.plot(d.setting, d.sens_90d, "o-", color=COLORS[rule], label=R.RULE_NAMES[rule])
    ax.set_xscale("log")
    ax.set_xlabel("Baseline window (past scores)")
    ax.set_ylabel("Detected within 90 days")
    ax.set_title("A short memory chases the decline and hides it")
    ax = axes[0, 3]
    labels = list(left_df.setting.unique())
    x = np.arange(len(labels))
    for k, rule in enumerate(vel):
        d = left_df[left_df.rule == rule].set_index("setting").loc[labels]
        ax.bar(x + (k - 1) * 0.27, d.false_alarms_per_patient_year_stable, 0.27, color=COLORS[rule], label=R.RULE_NAMES[rule])
    ax.set_xticks(x)
    ax.set_xticklabels([l.replace(" (as shipped)", "\n(as shipped)").replace("confidence at least", "confidence\n>=") for l in labels], fontsize=7)
    ax.set_ylabel("False alarms per stable patient-year")
    ax.set_title("Sessions she left part-way raise alarms")
    ax.legend(fontsize=7)
    axes[1, 3].axis("off")
    fig.tight_layout()
    save_figure(fig, "ablations.png", fig_meta(p))


if __name__ == "__main__":
    main()
