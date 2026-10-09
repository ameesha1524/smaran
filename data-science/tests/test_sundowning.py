"""The Python port against the same vectors the Java detector is held to, and against the Java's own unit cases."""

import json
import pytest

import sundowning as sd
from conftest import REPO

vectors = json.loads((REPO / "sundowning-vectors.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", vectors["vectors"], ids=[c["name"] for c in vectors["vectors"]])
def test_matches_the_shared_vectors(case):
    v = sd.evaluate([(s["gameId"], s["hour"], s["score"]) for s in case["sittings"]])
    want = case["expected"]
    assert v.enough_data == want["enoughData"]
    assert (v.morning, v.late_afternoon) == (want["morning"], want["lateAfternoon"])
    assert v.effect_size == pytest.approx(want["effectSize"], abs=1e-12)


def test_the_file_is_what_the_generator_writes():
    """The generator is run in memory and compared; the test never rewrites the committed file."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("make_sundowning_vectors", REPO / "scripts" / "make_sundowning_vectors.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert json.loads(json.dumps(module.build())) == vectors, "run: python scripts/make_sundowning_vectors.py"


def test_the_constants_are_the_servers():
    assert (vectors["flagAt"], vectors["endBelow"], vectors["minPerPart"]) == (sd.FLAG_AT, sd.END_BELOW, sd.MIN_PER_PART)


def test_cases_from_the_java_unit_tests():
    clear = [("a", 9, s) for s in (80, 82, 78, 81, 79, 83, 80)] + [("a", 17, s) for s in (60, 62, 58, 61, 59, 63, 60)]
    v = sd.evaluate(clear)
    assert v.flagged() and v.effect_size > 3 and (v.morning, v.late_afternoon) == (7, 7)
    better = sd.evaluate([("a", 9, s) for s in (60, 62, 58, 61, 59, 63)] + [("a", 17, s) for s in (80, 82, 78, 81, 79, 83)])
    assert not better.flagged() and better.effect_size < 0
    five = sd.evaluate([("a", 9, 90.0)] * 7 + [("a", 17, 10.0)] * 5)
    assert not five.enough_data and not five.flagged()
    assert sd.evaluate([("hard", 17, 50.0)] * 6 + [("easy", 9, 90.0)] * 6).effect_size == pytest.approx(0.0, abs=1e-9)
