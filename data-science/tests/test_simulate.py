"""The simulator does what its README says: reproducible, ground truth consistent, envelopes the server would accept."""

import json
import re
import uuid
from dataclasses import fields, replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import params as P
import scoring_core as sc
import simulate
from conftest import REGISTRY
from params import SimParams

README = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def cohort():
    return simulate.simulate(replace(SimParams(), n_patients=40, days=300))


def test_same_seed_same_cohort(cohort):
    again = simulate.simulate(replace(SimParams(), n_patients=40, days=300))
    pd.testing.assert_frame_equal(cohort.contributions, again.contributions)
    assert np.array_equal(cohort.latent, again.latent)


def test_a_different_seed_is_a_different_cohort(cohort):
    other = simulate.simulate(replace(SimParams(), n_patients=40, days=300, seed=1))
    assert not cohort.contributions.raw.equals(other.contributions.raw)


def test_a_patient_does_not_depend_on_the_size_of_the_cohort():
    a = simulate.simulate(replace(SimParams(), n_patients=30, days=200))
    b = simulate.simulate(replace(SimParams(), n_patients=60, days=200))
    # trajectories are shuffled by cohort size, but the same patient index with the same trajectory is the same person
    for i in range(30):
        if a.patients.trajectory[i] == b.patients.trajectory[i]:
            assert np.array_equal(a.latent[i], b.latent[i])
            assert a.contributions[a.contributions.patient_idx == i].raw.tolist() == b.contributions[b.contributions.patient_idx == i].raw.tolist()
            return
    pytest.fail("no patient with the same trajectory in both cohorts to compare")


def test_trajectory_shares_and_ground_truth(cohort):
    kinds = cohort.patients.trajectory.value_counts()
    assert kinds["stable"] == 16 and kinds["slow_decline"] == 8 and kinds["improving"] == 6
    p = cohort.params
    for i, kind in enumerate(cohort.patients.trajectory):
        truth = cohort.truth[cohort.truth.patient_idx == i].set_index("domain")
        for k, d in enumerate(sc.DOMAIN_IDS):
            curve = cohort.latent[i, :, k]
            row = truth.loc[d]
            if kind == "stable":
                assert row.direction == 0 and np.isnan(row.onset_day) and np.ptp(curve) == 0
            elif kind == "improving":
                assert row.direction == 1 and curve[-1] >= curve[0]
            elif kind == "single_domain":
                assert (row.direction == -1) == (not np.isnan(row.onset_day))
            else:
                assert row.direction == -1
            if row.direction != 0:
                onset = int(row.onset_day)
                assert onset >= p.onset_min_day // 2
                assert np.ptp(curve[:onset + 1]) == 0, "nothing changes before the onset"
                assert (np.diff(curve[onset:]) * row.direction >= -1e-9).all(), "it only ever moves the way it was told to"
    singles = cohort.truth[cohort.patients.set_index("patient_idx").trajectory.reindex(cohort.truth.patient_idx).to_numpy() == "single_domain"]
    assert (singles.groupby("patient_idx").direction.apply(lambda s: (s != 0).sum()) == 1).all()


def test_scores_are_in_range_and_rounded_like_the_tablet(cohort):
    c = cohort.contributions
    assert c.raw.between(0, 100).all() and c.confidence.between(0, 1).all()
    assert (c.raw * 10 - np.round(c.raw * 10)).abs().max() < 1e-6


def test_practice_effect_saturates_and_never_falls(cohort):
    s = cohort.sessions.merge(cohort.contributions[["session_idx", "practice"]].drop_duplicates("session_idx"), on="session_idx")
    for _, g in s.groupby(["patient_idx", "game_id"]):
        assert (np.diff(g.sort_values("practice_index").practice.to_numpy()) >= -1e-9).all()
    late = s[s.practice_index > 60].practice
    early = s[s.practice_index == 0].practice
    assert early.max() == 0 and late.mean() > 5


def test_abandoned_sessions_are_thin_readings(cohort):
    c = cohort.contributions
    assert c[c.abandoned].confidence.max() <= 0.45 + 1e-9
    assert c[~c.abandoned].confidence.min() >= 0.7 * 0.6 - 0.01


def test_sundowners_score_lower_late_and_others_do_not(cohort):
    c = cohort.contributions.merge(cohort.patients[["patient_idx", "sundowner"]], on="patient_idx")
    c = c[c.is_primary & c.completed]
    # remove each patient's own level so we compare the same people with themselves
    c = c.assign(rel=c.raw - c.groupby(["patient_idx", "target"]).raw.transform("mean"))
    late = c[(c.hour >= 15) & (c.hour <= 19)].groupby("sundowner").rel.mean()
    morning = c[(c.hour >= 6) & (c.hour <= 11)].groupby("sundowner").rel.mean()
    gap = morning - late
    assert gap[True] > 3 and abs(gap[False]) < 2


def test_envelopes_are_what_the_server_accepts(cohort):
    registry = {g["id"]: g for g in json.loads(REGISTRY.read_text(encoding="utf-8"))["games"]}
    envelopes = simulate.to_envelopes(cohort)
    ids = set()
    n = 0
    for patient in envelopes:
        last = ""
        for e in patient["envelopes"]:
            n += 1
            assert e["gameId"] in registry and not registry[e["gameId"]]["retired"]
            assert {c["target"] for c in e["contributions"]} <= set(registry[e["gameId"]]["targets"])
            assert len(e["contributions"]) <= 16
            assert all(0 <= c["raw"] <= 100 and 0 < c["confidence"] <= 1 for c in e["contributions"])
            uuid.UUID(e["clientSessionId"])
            assert e["clientSessionId"] not in ids
            ids.add(e["clientSessionId"])
            assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", e["startedAt"])
            assert e["startedAt"] >= last, "sessions are in time order"
            last = e["startedAt"]
            assert 0 <= e["hourOfDay"] <= 23 and 0 <= e["durationMs"] <= 6 * 3600 * 1000
            assert e["precomputedReading"] is True and e["engineVersion"] == sc.ENGINE_VERSION
            assert e["difficulty"]["tier"] in (1, 2, 3)
    assert n == len(cohort.sessions)


def test_the_deidentified_table_carries_no_identity_or_truth(cohort):
    t = simulate.deidentified_contributions(cohort)
    assert set(t.columns) == {"patient_hash", "session_seq", "day_offset", "weekday", "hour_of_day", "game_id", "completed",
                              "abandoned", "target", "raw", "confidence"}
    assert not t.patient_hash.str.contains("sim-").any() and t.patient_hash.str.fullmatch(r"[0-9a-f]{16}").all()
    assert simulate.pseudonym("a", "sim-0001") != simulate.pseudonym("b", "sim-0001")


def test_every_parameter_is_in_the_readme():
    names = [f.name for f in fields(SimParams)]
    missing = [n for n in names if f"`{n}`" not in README]
    assert not missing, f"README.md does not describe: {missing}"
    assert set(P.WHY) == set(names), "params.WHY must explain every parameter and nothing else"


def test_trajectory_shares_must_sum_to_one():
    with pytest.raises(ValueError):
        replace(SimParams(), p_stable=0.5).check()


def test_the_readme_table_is_the_one_the_code_generates():
    a, b = README.index(P.START), README.index(P.END)
    block = README[a + len(P.START):b].strip()
    assert block == P.assumption_table_markdown().strip(), "run: python src/params.py --write-readme"
