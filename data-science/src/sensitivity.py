"""Do the conclusions survive different assumptions?

Every number in the main results is conditional on the simulator's parameters. Here one assumption at a time is
moved well away from its default (noise halved and raised by half, no shared good-and-bad-day effect, declines half as
fast and twice as fast, one session a day or two, a lot of practice or none, games equally hard or very unequal)
on a smaller cohort, and the alert rules are judged again.

Two questions per variant:
  * as shipped, how often does each rule cry wolf on a stable patient, and how many real declines does it catch in 90 days?
  * at the same budget of 2 false alarms per patient-year, which rule catches most? (Does the ordering hold?)

Point estimates only (no bootstrap): this is a check on the ordering and the scale, not a second set of results.
Writes results/sensitivity.csv and results/figures/sensitivity.png.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

import rules as R
from common import COLORS, fig_meta, get_cohort, params_from_env, save_figure, save_table
from evaluate_rules import Setup, sweeps
from params import SimParams

BUDGET = 2.0


def variants(p: SimParams) -> list[tuple[str, SimParams]]:
    rate = lambda f: dict(slow_rate=p.slow_rate * f, fast_rate=p.fast_rate * f, single_rate=p.single_rate * f)
    return [
        ("defaults", p),
        ("noise x0.5", replace(p, noise_sd_primary=p.noise_sd_primary * 0.5, noise_sd_secondary=p.noise_sd_secondary * 0.5)),
        ("noise x1.5", replace(p, noise_sd_primary=p.noise_sd_primary * 1.5, noise_sd_secondary=p.noise_sd_secondary * 1.5)),
        ("no shared day effect", replace(p, day_sd=0.0)),
        ("shared day effect x2", replace(p, day_sd=p.day_sd * 2)),
        ("declines half as fast", replace(p, **rate(0.5))),
        ("declines twice as fast", replace(p, **rate(2.0))),
        ("about one session a day", replace(p, sessions_extra_mean=0.0)),
        ("up to three a day", replace(p, sessions_extra_mean=1.5)),
        ("fewer days played", replace(p, lapse_start_mean=0.25)),
        ("no practice effect", replace(p, practice_max_mean=0.0, practice_max_sd=0.0)),
        ("double practice effect", replace(p, practice_max_mean=p.practice_max_mean * 2)),
        ("games equally hard", replace(p, game_bias_sd=0.0)),
        ("games very unequal", replace(p, game_bias_sd=p.game_bias_sd * 2)),
    ]


def main() -> None:
    p = params_from_env()
    small = replace(p, n_patients=min(p.n_patients, 100))
    rows = []
    for name, q in variants(small):
        q = replace(q, seed=small.seed + 7)
        S = Setup(get_cohort(q, cache=False))
        sw = sweeps(S)
        for rule in R.RULES:
            m = R.metrics(S.outcome("on", rule, R.DEFAULT_THRESHOLD[rule]))
            within = sw[(sw.rule == rule) & (sw.false_alarms_per_patient_year_stable <= BUDGET)]
            best = within.sort_values(["sens_90d", "sens_30d"], ascending=False).iloc[0] if len(within) else None
            rows.append({
                "variant": name, "rule": rule, "name": R.RULE_NAMES[rule],
                "shipped_sens_90d": m["sens_90d"], "shipped_false_alarms_per_patient_year": m["false_alarms_per_patient_year_stable"],
                "shipped_median_delay_days": m["median_delay_days"],
                f"sens_90d_at_{BUDGET:g}_false_alarms": float(best.sens_90d) if best is not None else np.nan,
            })
        print(f"  {name}")
    df = pd.DataFrame(rows)
    save_table(df, "sensitivity.csv")

    key = f"sens_90d_at_{BUDGET:g}_false_alarms"
    names = list(df.variant.unique())
    fig, axes = plt.subplots(1, 2, figsize=(13, 5), sharey=True)
    y = np.arange(len(names))[::-1]
    for ax, col, title in ((axes[0], key, f"Detected within 90 days at {BUDGET:g} false alarms per patient-year"),
                           (axes[1], "shipped_false_alarms_per_patient_year", "False alarms per stable patient-year, as shipped")):
        for rule in R.RULES:
            d = df[df.rule == rule].set_index("variant").loc[names]
            ax.scatter(d[col], y, color=COLORS[rule], label=R.RULE_NAMES[rule], s=34, zorder=3)
        ax.set_yticks(y)
        ax.set_yticklabels(names)
        ax.set_title(title, fontsize=10)
        ax.grid(axis="y", alpha=0.2)
    axes[1].set_xscale("symlog", linthresh=1)
    axes[0].legend(fontsize=8, loc="lower right")
    save_figure(fig, "sensitivity.png", fig_meta(small, budget=BUDGET))


if __name__ == "__main__":
    main()
