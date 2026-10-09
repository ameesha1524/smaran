"""Every number the simulator assumes, with the reason it is that number.

None of these is an estimate from patients. They are chosen so the effects the
evaluation is about (a decline, a practice curve, a late-day dip) are present
at plausible-looking sizes and a method can be shown to find them or not. The
results say how the rules behave *given these assumptions*. Change one and the
answer may change; `sensitivity.py` does that for the ones that matter most.

README.md lists every field below in a table; tests/test_simulate.py fails if a
field is added here and not described there.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, replace


@dataclass(frozen=True)
class SimParams:
    # --- the cohort -------------------------------------------------------
    n_patients: int = 200
    days: int = 365
    seed: int = 20261009
    start_date: str = "2025-01-06"  # a Monday; only the weekday and the order of days matter

    # share of patients on each trajectory; must sum to 1
    p_stable: float = 0.40
    p_slow_decline: float = 0.20
    p_fast_decline: float = 0.10
    p_single_domain: float = 0.15
    p_improving: float = 0.15

    # --- who she is (the level she holds before any change) -----------------
    level_mean: float = 58.0
    level_sd_between: float = 14.0   # how far apart two patients are
    level_sd_domain: float = 6.0     # how far one patient's domains are from her own mean
    level_floor: float = 15.0
    level_ceiling: float = 90.0

    # --- change over time ---------------------------------------------------
    onset_min_day: int = 60          # a baseline exists before the change
    onset_max_day: int = 200
    slow_rate: float = 0.06          # points per day
    fast_rate: float = 0.25
    single_rate: float = 0.15
    improve_rate: float = 0.08
    slow_max_drop: float = 40.0      # points; a decline stops here
    fast_max_drop: float = 35.0
    single_max_drop: float = 35.0
    improve_max_gain: float = 15.0
    rate_jitter: float = 0.4         # each domain's rate is x U(1 - j, 1 + j)
    onset_jitter_days: int = 10      # each domain's onset differs by up to this

    # --- day-to-day variation shared by everything she plays that day -------
    day_sd: float = 3.0
    day_phi: float = 0.6             # AR(1) day to day

    # --- what a game adds -----------------------------------------------------
    noise_sd_primary: float = 7.0    # observation noise on a game's main domain
    noise_sd_secondary: float = 11.0 # on a game's other domains: a weaker, noisier read
    game_bias_sd: float = 4.0        # games differ in how hard they are (fixed per game and domain)
    abandoned_noise_mult: float = 1.5
    abandoned_shift: float = -4.0

    # --- practice -------------------------------------------------------------
    practice_max_mean: float = 10.0  # points gained by repetition, per game
    practice_max_sd: float = 3.0
    practice_tau_median: float = 10.0  # sessions of that game to reach ~63% of it
    practice_tau_sigma: float = 0.3    # log-normal spread of tau

    # --- when she plays ---------------------------------------------------------
    lapse_start_mean: float = 0.12   # P(active day -> lapsed day)
    lapse_end_mean: float = 0.30     # P(lapsed day -> active day)
    sessions_extra_mean: float = 0.5 # sessions on an active day = 1 + Poisson(this), at most 3
    dropout_share: float = 0.08      # patients who stop entirely, uniformly in the second half
    p_morning: float = 0.40          # 7 to 11
    p_midday: float = 0.20           # 12 to 14
    p_afternoon: float = 0.35        # 15 to 19
    # the remaining 5% is evening, 20 to 21

    # --- abandonment --------------------------------------------------------------
    abandon_logit_mean: float = -3.4     # the base rate; with the effects below about one sitting in ten is left
    abandon_logit_sd: float = 0.8        # patients differ (non-IID)
    abandon_late_effect: float = 0.8
    abandon_sundown_extra: float = 1.2
    abandon_after_abandon: float = 0.9
    abandon_low_recent: float = 0.5      # per 10 points the last few raws are under 55
    abandon_low_mood: float = 0.6
    abandon_tier: float = 0.3
    abandoned_conf_lo: float = 0.15
    abandoned_conf_hi: float = 0.45

    # --- the late-day dip -------------------------------------------------------------
    sundowner_share: float = 0.20
    sundown_lo: float = 6.0          # points off 15:00-19:59 sittings
    sundown_hi: float = 14.0
    afternoon_sd_others: float = 1.5 # everyone else has a small, random afternoon difference

    # --- confidence of a completed session ---------------------------------------------
    conf_lo: float = 0.7
    conf_hi: float = 1.0
    conf_secondary_mult: float = 0.6

    def check(self) -> None:
        total = self.p_stable + self.p_slow_decline + self.p_fast_decline + self.p_single_domain + self.p_improving
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"trajectory shares sum to {total}, not 1")

    def small(self) -> "SimParams":
        """The cut-down cohort the CI job runs: same rules, fewer patients, a shorter year."""
        return replace(self, n_patients=48, days=300)


#: name -> (why this number). Rendered into README.md by `assumption_rows()`.
WHY = {
    "n_patients": "Enough that a 95% interval on a sensitivity is not enormous; small enough to run in minutes.",
    "days": "A year: long enough for a slow decline to show and for 14- and 30-day windows to be meaningful.",
    "seed": "Fixed so every run is the same run.",
    "start_date": "Arbitrary. A fixed calendar so weekday and hour are real quantities.",
    "p_stable": "Most people using a reminiscence app are not changing month to month. Includes stable low scorers, who are the point of the absolute-level rule's comparison.",
    "p_slow_decline": "Gradual change is the common pattern in the early-to-moderate stages.",
    "p_fast_decline": "A minority decline quickly (an acute illness, a stroke, a medication change).",
    "p_single_domain": "One domain falls while the rest hold: the signal the dashboard exists to surface.",
    "p_improving": "People also get better (treatment of depression, a new routine). A rule that cries wolf on recovery is wrong too.",
    "level_mean": "Mid-scale, so there is room to fall and to rise.",
    "level_sd_between": "People differ a lot from one another; this is what makes a single absolute cut-off a poor idea.",
    "level_sd_domain": "One person is better at some things than others.",
    "level_floor": "Nobody the games can score sits at zero.",
    "level_ceiling": "Leaves room for the practice effect without every score hitting 100.",
    "onset_min_day": "At least two months of baseline before anything changes, so the first alert cannot be a warm-up artefact.",
    "onset_max_day": "Leaves at least 165 days after the latest onset to be detected in.",
    "slow_rate": "About 22 points over a year. Chosen so slow decline is visible in months, not an estimate of how fast anyone declines.",
    "fast_rate": "About 7.5 points a month until the cap.",
    "single_rate": "Between the two: one domain falling at a moderate rate.",
    "improve_rate": "Gentler than a decline; improvement is slower than loss.",
    "slow_max_drop": "A decline does not run to zero within the year.",
    "fast_max_drop": "A rapid fall that then plateaus.",
    "single_max_drop": "As above.",
    "improve_max_gain": "A recovery that levels off.",
    "rate_jitter": "Domains do not fall in lockstep.",
    "onset_jitter_days": "Nor start on the same day.",
    "day_sd": "Good days and bad days that touch every game she plays that day. Without it every sitting would be independent noise, which flatters every rule.",
    "day_phi": "A bad day tends to follow a bad day.",
    "noise_sd_primary": "Session-to-session scatter of a game's main score. Sets how large a change must be before it stands out.",
    "noise_sd_secondary": "A game's other domains are a weaker read of the same thing.",
    "game_bias_sd": "A hard game scores lower than an easy one. The engine pools games within a domain, so this is real extra scatter.",
    "abandoned_noise_mult": "A sitting she leaves is less reliable.",
    "abandoned_shift": "And a little lower.",
    "practice_max_mean": "Repetition raises scores a few points before it stops. The size is an assumption; that it saturates is well established for repeated cognitive tasks.",
    "practice_max_sd": "People differ in how much they gain.",
    "practice_tau_median": "About ten sittings of a game to get most of it.",
    "practice_tau_sigma": "Games differ in how fast they are learned.",
    "lapse_start_mean": "With the next number gives about 71% of days active.",
    "lapse_end_mean": "A lapse lasts about three days on average.",
    "sessions_extra_mean": "Most active days have one or two sittings.",
    "dropout_share": "Some people stop, and a rule is judged on those it must not miss while they are still there.",
    "p_morning": "Her morning routine.",
    "p_midday": "After lunch.",
    "p_afternoon": "The late-afternoon window the sundowning detector looks at.",
    "abandon_logit_mean": "With the effects below, roughly one sitting in ten is left unfinished.",
    "abandon_logit_sd": "Patients differ in how often they leave a game: the non-IID that makes federated learning interesting.",
    "abandon_late_effect": "Late-day sittings are left more often.",
    "abandon_sundown_extra": "Especially by the late-day-dip subgroup.",
    "abandon_after_abandon": "Leaving once makes leaving again more likely.",
    "abandon_low_recent": "She leaves more when she has been scoring low.",
    "abandon_low_mood": "And when she begins low.",
    "abandon_tier": "And when the game is hard.",
    "abandoned_conf_lo": "A part-played sitting is a thin reading.",
    "abandoned_conf_hi": "A part-played sitting is a thin reading.",
    "sundowner_share": "Prevalence is a guess; it is high enough to evaluate the detector and low enough to be a subgroup.",
    "sundown_lo": "Small enough to be hard, large enough to find in a month.",
    "sundown_hi": "Upper end of the same range.",
    "afternoon_sd_others": "Nobody is exactly constant across the day; this is the null the detector must not trip over.",
    "conf_lo": "A finished sitting is mostly trustworthy.",
    "conf_hi": "A finished sitting is mostly trustworthy.",
    "conf_secondary_mult": "A game's other domains carry less weight.",
}


def assumption_rows(p: SimParams | None = None) -> list[tuple[str, object, str]]:
    p = p or SimParams()
    return [(f.name, getattr(p, f.name), WHY[f.name]) for f in fields(p)]


def assumption_table_markdown(p: SimParams | None = None) -> str:
    lines = ["| Parameter | Value | Why |", "|---|---|---|"]
    for name, value, why in assumption_rows(p):
        lines.append(f"| `{name}` | {value} | {why} |")
    return "\n".join(lines)


START = "<!-- assumptions:start (generated by `python src/params.py --write-readme`; do not edit by hand) -->"
END = "<!-- assumptions:end -->"


def write_readme(path) -> None:
    """Replace the block between the markers in README.md with the table generated from SimParams and WHY."""
    from pathlib import Path

    p = Path(path)
    text = p.read_text(encoding="utf-8")
    a, b = text.index(START), text.index(END)
    p.write_text(text[:a] + START + "\n\n" + assumption_table_markdown() + "\n\n" + text[b:], encoding="utf-8")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    if "--write-readme" in sys.argv:
        write_readme(Path(__file__).resolve().parents[1] / "README.md")
    else:
        print(assumption_table_markdown())
