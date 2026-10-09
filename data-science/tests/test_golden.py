"""The Python engine against golden-vectors.json, the file the TypeScript and Java engines are held to."""

import json
import math

import pytest

import scoring_core as sc
from conftest import GOLDEN

golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
NUMERIC = ["raw", "confidence", "level", "baseline", "sd", "velocity", "domainConfidence"]
FIELD = {
    "raw": "raw", "confidence": "confidence", "level": "level", "baseline": "baseline",
    "sd": "sd", "velocity": "velocity", "domainConfidence": "domain_confidence",
}


def test_the_file_is_there_and_has_cases():
    assert len(golden["cases"]) >= 12


def test_defaults_are_the_golden_defaults():
    assert sc.ScoringConfig.from_golden(golden["config"]) == sc.DEFAULT_CONFIG
    assert golden["engineVersion"] == sc.ENGINE_VERSION


def test_contract_lists_match():
    assert tuple(golden["contract"]["domains"]) == sc.DOMAIN_IDS
    assert tuple(golden["contract"]["subSignals"]) == sc.SUB_SIGNAL_IDS
    assert tuple(golden["contract"]["statuses"]) == sc.STATUSES
    assert tuple(golden["contract"]["alertRules"]) == sc.ALERT_RULES


@pytest.mark.parametrize("case", golden["cases"], ids=[c["name"] for c in golden["cases"]])
def test_replays_exactly(case):
    config = sc.ScoringConfig.from_golden({**golden["config"], **case["config"]})
    state = {t: sc.TargetState.from_golden(s) for t, s in case["initial"].items()}
    readings = []
    for c in case["contributions"]:
        state, got = sc.apply_session(state, [(c["target"], c["raw"], c["confidence"])], config)
        readings.extend(got)

    assert len(readings) == len(case["expected"])
    for r, want in zip(readings, case["expected"]):
        assert r.target == want["target"]
        assert r.status == want["status"]
        assert r.alert == want["alert"]
        for key in NUMERIC:
            assert math.isclose(getattr(r, FIELD[key]), want[key], rel_tol=0, abs_tol=1e-9), (key, getattr(r, FIELD[key]), want[key])

    assert set(state) == set(case["finalState"])
    for target, want in case["finalState"].items():
        got = state[target].to_golden()
        assert got["observations"] == want["observations"]
        assert got["runWatch"] == want["runWatch"] and got["runDecline"] == want["runDecline"]
        assert math.isclose(got["level"], want["level"], abs_tol=1e-9)
        assert math.isclose(got["cusum"], want["cusum"], abs_tol=1e-9)
        assert len(got["raws"]) == len(want["raws"])
        for a, b in zip(got["raws"], want["raws"]):
            assert math.isclose(a, b, abs_tol=1e-9)


def test_replay_equals_applying_one_by_one():
    case = next(c for c in golden["cases"] if c["name"] == "two-consecutive-decline")
    config = sc.ScoringConfig.from_golden({**golden["config"], **case["config"]})
    sessions = [[(c["target"], c["raw"], c["confidence"])] for c in case["contributions"]]
    state = sc.replay(sessions, config)
    assert state[case["contributions"][0]["target"]].observations == len(sessions)


def test_a_test_can_fail():
    """If the rule changed, the golden replay must notice (the guard the other two engines have)."""
    case = next(c for c in golden["cases"] if c["name"] == "single-rule")
    wrong = sc.ScoringConfig.from_golden({**golden["config"], **case["config"]}).with_(decline_velocity=-3.0)
    state = {}
    alerts = []
    for c in case["contributions"]:
        state, got = sc.apply_session(state, [(c["target"], c["raw"], c["confidence"])], wrong)
        alerts.extend(r.alert for r in got)
    assert alerts != [e["alert"] for e in case["expected"]]
