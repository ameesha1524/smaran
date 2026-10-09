"""The rule scores in rules.py must agree with the engine's own alerts, and the metrics must be right on a case worked by hand."""

from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

import rules
import scoring_core as sc
import simulate
from params import SimParams
from replay import SequenceIndex, replay_frame


@pytest.fixture(scope="module")
def cohort():
    return simulate.simulate(replace(SimParams(), n_patients=24, days=240))


@pytest.mark.parametrize("rule,engine_rule", [("R1", "SINGLE"), ("R2", "TWO_CONSECUTIVE"), ("R3", "CUSUM")])
@pytest.mark.parametrize("gate", [0.35, 0.0])
def test_default_threshold_fires_where_the_engine_alerts(cohort, rule, engine_rule, gate):
    cfg = sc.DEFAULT_CONFIG.with_(alert_rule=engine_rule, confidence_gate=gate)
    frame = replay_frame(cohort.contributions, cfg)
    index = SequenceIndex.of(frame)
    fires = rules.alarm_scores(frame, index, rule) >= rules.DEFAULT_THRESHOLD[rule]
    assert fires.sum() > 50, "a vacuous comparison proves nothing"
    assert np.array_equal(fires, frame.alert.to_numpy() > 0)


def test_the_gate_silences_the_first_readings(cohort):
    frame = replay_frame(cohort.contributions)
    index = SequenceIndex.of(frame)
    for rule in rules.RULES:
        s = rules.alarm_scores(frame, index, rule)
        assert np.all(np.isneginf(s[frame.obs.to_numpy() < 5]))


def test_episodes_merge_fires_within_the_gap():
    days = np.array([10, 11, 12, 20, 21, 40])
    assert list(rules.episode_starts(days, gap=7)) == [10, 20, 40]
    assert list(rules.episode_starts(days, gap=8)) == [10, 40]
    assert len(rules.episode_starts(np.array([]))) == 0


def _truth(start, end, onset, direction, latent_value=60.0):
    domains = sc.DOMAIN_IDS
    n_days = end + 60
    latent = np.full((1, n_days, 6), latent_value)
    return rules.Truth(
        onset={(0, d): (onset if i == 0 else np.nan) for i, d in enumerate(domains)},
        direction={(0, d): (direction if i == 0 else 0) for i, d in enumerate(domains)},
        start_day=np.array([start]), end_day=np.array([end]), latent=latent,
        kind=np.array(["slow_decline"]), base_level=np.array([60.0]),
    )


def test_delay_sensitivity_and_false_alarms_worked_by_hand():
    # One patient, follow-up days 0..199, one declining domain (onset 100) with fires on days 50 (a false
    # alarm), 104 and 105 (the detection and its continuation). Only sequences with data are scored.
    frame = pd.DataFrame({
        "patient_idx": 0, "target": "LANGUAGE", "day": [10, 50, 104, 105, 199],
    })
    index = SequenceIndex.of(frame.assign(session_idx=range(5)))
    fires = np.array([False, True, True, True, False])
    truth = _truth(0, 199, 100, -1)
    pp = rules.evaluate_fires(frame, index, fires, truth)
    m = rules.metrics(pp)
    assert m["sens_14d"] == 1.0 and m["sens_30d"] == 1.0 and m["sens_60d"] == 1.0
    assert m["sens_90d"] == 1.0                      # 199 - 100 = 99 days of follow-up, so the pair counts for 90
    assert m["median_delay_days"] == 4
    assert pp.episodes_neg[0] == 1                   # day 50 only; 104 is after the onset
    assert pp.neg_pair_days[0] == 100                # days 0..99, before the onset
    assert m["rmtd_90d"] == 4
    # the same run if she had stopped playing on day 110: nothing is demanded of the rule beyond her follow-up
    short = _truth(0, 110, 100, -1)
    pp2 = rules.evaluate_fires(frame[frame.day <= 110], SequenceIndex.of(frame[frame.day <= 110].assign(session_idx=range(4))),
                               fires[:4], short)
    assert pp2.risk[14][0] == 0 and np.isnan(rules.metrics(pp2)["sens_14d"])


def test_a_miss_is_a_miss():
    frame = pd.DataFrame({"patient_idx": 0, "target": "LANGUAGE", "day": [10, 120, 190], "session_idx": range(3)})
    pp = rules.evaluate_fires(frame, SequenceIndex.of(frame), np.array([False, False, False]), _truth(0, 199, 100, -1))
    m = rules.metrics(pp)
    assert m["sens_30d"] == 0.0 and m["rmtd_90d"] == 90.0 and np.isnan(m["median_delay_days"])


def test_weighted_auc_matches_scikit_learn_and_handles_ties():
    from sklearn.metrics import average_precision_score, roc_auc_score
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 500)
    s = np.round(rng.normal(y * 0.8, 1.0), 1)          # lots of ties
    auc, ap = rules.weighted_roc_pr(s, y, np.ones(500))
    assert auc == pytest.approx(roc_auc_score(y, s), abs=1e-12)
    assert ap == pytest.approx(average_precision_score(y, s), abs=1e-12)
    # a weight of 2 is the same as the case twice
    w = rng.integers(0, 3, 500).astype(float)
    idx = np.repeat(np.arange(500), w.astype(int))
    auc_w, ap_w = rules.weighted_roc_pr(s, y, w)
    assert auc_w == pytest.approx(roc_auc_score(y[idx], s[idx]), abs=1e-12)
    assert ap_w == pytest.approx(average_precision_score(y[idx], s[idx]), abs=1e-12)


def test_window_labels(cohort):
    frame = replay_frame(cohort.contributions)
    index = SequenceIndex.of(frame)
    truth = rules.Truth.of(cohort)
    table = rules.window_table(frame, index, rules.alarm_scores(frame, index, "R2"), truth)
    assert table.label.sum() > 0 and (table.label == 0).sum() > table.label.sum()
    # no positive window can come from a patient with no decline anywhere
    stable = {i for i, k in enumerate(truth.kind) if k in ("stable", "improving")}
    assert not set(table[table.label == 1].patient_idx) & stable
