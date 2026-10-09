"""The pieces that connect the engine to the analyses: replay, the evaluation on a world with no noise, practice, federated learning."""

import json
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

import federated_sim as fl
import practice
import rules
import scoring_core as sc
import simulate
from conftest import REPO
from params import SimParams
from replay import SequenceIndex, replay_frame


def quiet_world(**changes):
    """No noise of any kind, no practice, no game differences: what the games see is exactly her ability."""
    base = replace(SimParams(), n_patients=20, days=240, noise_sd_primary=0.0, noise_sd_secondary=0.0, day_sd=0.0,
                   game_bias_sd=0.0, abandoned_shift=0.0, practice_max_mean=0.0, practice_max_sd=0.0, afternoon_sd_others=0.0,
                   sundowner_share=0.0, dropout_share=0.0, p_stable=0.5, p_slow_decline=0.0, p_fast_decline=0.5,
                   p_single_domain=0.0, p_improving=0.0, onset_min_day=60, onset_max_day=100, level_sd_domain=0.0)
    return simulate.simulate(replace(base, **changes))


def test_replay_frame_is_the_engine_applied_in_order():
    c = simulate.simulate(replace(SimParams(), n_patients=4, days=120))
    frame = replay_frame(c.contributions)
    first = frame[(frame.patient_idx == 1) & (frame.target == "LANGUAGE")]
    state, levels = {}, []
    sub = c.contributions[(c.contributions.patient_idx == 1) & (c.contributions.target == "LANGUAGE")].sort_values("session_idx")
    for r in sub.itertuples():
        state, got = sc.apply_session(state, [(r.target, r.raw, r.confidence)])
        levels.append(got[0].level)
    assert np.allclose(first.level.to_numpy(), levels, atol=0, rtol=0)


def test_with_no_noise_a_fast_decline_is_found_and_a_stable_patient_is_never_alarmed():
    c = quiet_world()
    truth = rules.Truth.of(c)
    frame = replay_frame(c.contributions)
    index = SequenceIndex.of(frame)
    for rule in ("R1", "R2", "R3"):
        score = rules.alarm_scores(frame, index, rule)
        pp = rules.evaluate_fires(frame, index, score >= rules.DEFAULT_THRESHOLD[rule], truth)
        m = rules.metrics(pp)
        # all but the odd slowest-falling domain: a steady slope under the 3-point SD floor sits just inside the
        # watch threshold, which is the engine's arithmetic and not a bug in the evaluation
        assert m["sens_90d"] >= 0.95, rule
        assert m["false_alarms_per_patient_year_stable"] == 0.0, rule
        # in a world with no noise the engine fires within a month of a fast decline
        assert m["median_delay_days"] <= 30, rule


def test_with_no_noise_the_absolute_level_rule_still_alarms_on_a_stable_person_who_scores_low():
    c = quiet_world(level_mean=30.0, level_sd_between=2.0)
    truth = rules.Truth.of(c)
    frame = replay_frame(c.contributions)
    index = SequenceIndex.of(frame)
    r0 = rules.evaluate_fires(frame, index, rules.alarm_scores(frame, index, "R0") >= rules.DEFAULT_THRESHOLD["R0"], truth)
    r2 = rules.evaluate_fires(frame, index, rules.alarm_scores(frame, index, "R2") >= rules.DEFAULT_THRESHOLD["R2"], truth)
    assert rules.metrics(r0)["false_alarms_per_patient_year_stable"] > 0.5, "nothing has changed, yet a level cut-off fires"
    assert rules.metrics(r2)["false_alarms_per_patient_year_stable"] == 0.0


def test_bootstrap_intervals_contain_the_point_estimate_and_are_seeded():
    c = simulate.simulate(replace(SimParams(), n_patients=30, days=240))
    truth = rules.Truth.of(c)
    frame = replay_frame(c.contributions)
    index = SequenceIndex.of(frame)
    pp = rules.evaluate_fires(frame, index, rules.alarm_scores(frame, index, "R2") >= 0.8, truth)
    a = rules.with_intervals(pp, 200, 1)
    b = rules.with_intervals(pp, 200, 1)
    assert a == b
    for k in ("sens_90d", "false_alarms_per_patient_year_stable"):
        assert a[k + "_lo"] <= a[k] <= a[k + "_hi"]


# ---------------------------------------------------------------------- practice


def test_adjustment_adds_back_exactly_what_she_had_not_yet_gained():
    df = pd.DataFrame({"raw": [50.0, 50.0, 50.0], "practice_index": [0, 10, 1000]})
    out = practice.adjust(df, pmax=10.0, tau=10.0)
    assert out.raw.tolist() == [60.0, round(50 + 10 * np.exp(-1), 1), 50.0]
    assert practice.adjust(df.assign(raw=[98.0] * 3), 10.0, 10.0).raw.max() == 100.0


# -------------------------------------------------------------------- federated


def test_the_local_fit_follows_the_gradient_it_claims_to():
    rng = np.random.default_rng(0)
    X = rng.random((50, 6))
    y = (rng.random(50) < 0.3).astype(float)
    w0, b0 = rng.normal(0, 0.1, 6), 0.05
    w1, b1 = fl.local_fit(w0, b0, X, y, epochs=1)
    # one epoch is one step down the regularised log-loss gradient
    eps = 1e-6
    g = np.zeros(6)
    for i in range(6):
        d = np.zeros(6)
        d[i] = eps
        g[i] = (fl.log_loss(w0 + d, b0, X, y) - fl.log_loss(w0 - d, b0, X, y)) / (2 * eps) + fl.L2 * w0[i]
    gb = (fl.log_loss(w0, b0 + eps, X, y) - fl.log_loss(w0, b0 - eps, X, y)) / (2 * eps)
    assert np.allclose(w1, w0 - fl.LR * g, atol=1e-7)
    assert b1 == pytest.approx(b0 - fl.LR * gb, abs=1e-7)


def test_fedavg_with_one_client_is_that_clients_own_training():
    rng = np.random.default_rng(1)
    client = {"patient": 0, "Xtr": rng.random((40, 6)), "ytr": (rng.random(40) < 0.4).astype(float)}
    w, b, k = fl.fedavg_round(np.zeros(6), 0.0, [client], rng, 1.0)
    w2, b2 = fl.local_fit(np.zeros(6), 0.0, client["Xtr"], client["ytr"])
    assert k == 1 and np.allclose(w, w2) and b == pytest.approx(b2)


def test_fedavg_weights_clients_by_how_much_data_they_have():
    rng = np.random.default_rng(2)
    big = {"patient": 0, "Xtr": rng.random((90, 6)), "ytr": np.ones(90)}
    small = {"patient": 1, "Xtr": rng.random((10, 6)), "ytr": np.zeros(10)}
    w, b, _ = fl.fedavg_round(np.zeros(6), 0.0, [big, small], rng, 1.0)
    wb, bb = fl.local_fit(np.zeros(6), 0.0, big["Xtr"], big["ytr"])
    ws, bs = fl.local_fit(np.zeros(6), 0.0, small["Xtr"], small["ytr"])
    assert b == pytest.approx(0.9 * bb + 0.1 * bs)
    assert np.allclose(w, 0.9 * wb + 0.1 * ws)


def test_auc_matches_scikit_learn():
    from sklearn.metrics import roc_auc_score
    rng = np.random.default_rng(3)
    y = (rng.random(300) < 0.2).astype(float)
    s = rng.normal(y, 1.0)
    assert fl.auc(s, y) == pytest.approx(roc_auc_score(y, s), abs=1e-12)


def test_the_features_are_the_tablets_six_in_the_tablets_order():
    text = (REPO / "frontend" / "src" / "lib" / "federated.ts").read_text(encoding="utf-8")
    for name in fl.FEATURES:
        assert f"'{name}'" in text
    positions = [text.index(f"'{n}'") for n in fl.FEATURES]
    assert positions == sorted(positions)
    assert "epochs = 24, lr = 0.28" in text and "0.01 * weights[i]" in text


def test_an_update_is_small_on_the_wire():
    assert fl.comm_bytes(np.full(6, 0.123456), 0.654321) < 200
