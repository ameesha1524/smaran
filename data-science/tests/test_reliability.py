import numpy as np
import pytest

import reliability as rel

# Shrout & Fleiss (1979), Table 2: six targets rated by four judges.
SF = np.array([[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]], dtype=float)


def test_icc_reproduces_the_published_example():
    r = rel.icc(SF)
    assert r["icc1"] == pytest.approx(0.17, abs=0.005)
    assert r["icc21"] == pytest.approx(0.29, abs=0.005)
    assert r["icc31"] == pytest.approx(0.71, abs=0.005)


def test_icc_is_one_for_identical_columns_and_near_zero_for_noise():
    x = np.random.default_rng(0).normal(size=(200, 1))
    assert rel.icc(np.hstack([x, x]))["icc21"] == pytest.approx(1.0)
    noise = np.random.default_rng(1).normal(size=(2000, 2))
    assert abs(rel.icc(noise)["icc21"]) < 0.06


def test_icc_matches_the_variance_ratio_it_estimates():
    rng = np.random.default_rng(2)
    true = rng.normal(0, 3, 4000)               # between-subject SD 3
    obs = np.stack([true + rng.normal(0, 4, 4000), true + rng.normal(0, 4, 4000)], axis=1)  # noise SD 4
    assert rel.icc(obs)["icc31"] == pytest.approx(9 / (9 + 16), abs=0.03)


def test_a_shared_shift_costs_absolute_agreement_but_not_consistency():
    rng = np.random.default_rng(3)
    base = rng.normal(0, 3, 300)
    x = np.stack([base + rng.normal(0, 1, 300), base + 8 + rng.normal(0, 1, 300)], axis=1)
    r = rel.icc(x)
    assert r["icc31"] > 0.8 and r["icc21"] < r["icc31"] - 0.2


def test_spearman_brown():
    assert rel.spearman_brown(0.5, 1) == 0.5
    assert rel.spearman_brown(0.5, 3) == pytest.approx(0.75)
