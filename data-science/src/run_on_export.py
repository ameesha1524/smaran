"""Proves the evaluation code runs on data the API exported, and gets the same answers as on the cohort it came from.

The backend loads a synthetic cohort through its real ingestion service, an administrator downloads
GET /api/admin/export/sessions.csv, and this script reads that file with the same code the notebooks use:

  1. the export has exactly the columns the simulator's de-identified table has, and nothing that identifies anyone;
  2. every score, confidence, hour, game and flag in it equals what was loaded (nothing lost or invented on the
     way through the database), and its day offsets agree with the sessions' real days;
  3. the engine replay, the alert-rule evaluation (rules.py) and the sundowning evaluation produce *identical* results
     on the exported table and on the original cohort;
  4. and so the same code could be pointed at a real export.

    python src/run_on_export.py --csv ../backend/target/export-sessions.csv \\
        --hash-map ../backend/target/export-hash-map.json --cohort ../backend/src/test/resources/cohort

The hash map (hash -> simulated patient id) exists only because the backend test knows its own salt; a real export
has none, which is the point of it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import rules as R
import scoring_core as sc
import simulate
import sundowning
from common import save_table
from replay import SequenceIndex, replay_frame

COLUMNS = ["patient_hash", "session_seq", "day_offset", "weekday", "hour_of_day", "game_id", "completed", "abandoned",
           "target", "raw", "confidence"]
FORBIDDEN = re.compile(r"sim-|cohort-|@|because|simulated session", re.I)


def read_export(path: Path) -> pd.DataFrame:
    text = Path(path).read_text(encoding="utf-8")
    if FORBIDDEN.search(text):
        raise SystemExit("the export contains something that looks like an id, an address or free text")
    df = pd.read_csv(path)
    if list(df.columns) != COLUMNS:
        raise SystemExit(f"unexpected columns: {list(df.columns)}")
    if not df.patient_hash.astype(str).str.fullmatch(r"[0-9a-f]{16}").all():
        raise SystemExit("patient_hash is not a 16 character hex string")
    return df


def attach(cohort: simulate.Cohort, export: pd.DataFrame, hash_map: dict) -> pd.DataFrame:
    """The cohort's contributions as the export says them (scores from the export, everything else from the cohort)."""
    patient_idx = export.patient_hash.map(lambda h: int(hash_map[h].split("-")[1]) - 1)
    ex = export.assign(patient_idx=patient_idx)
    sessions = cohort.sessions[["session_idx", "patient_idx", "patient_seq", "day", "hour"]]
    first_day = sessions.groupby("patient_idx").day.min().rename("first_day")
    ex = ex.merge(sessions, left_on=["patient_idx", "session_seq"], right_on=["patient_idx", "patient_seq"], how="left", validate="m:1")
    ex = ex.join(first_day, on="patient_idx")
    if ex.session_idx.isna().any():
        raise SystemExit("the export has sessions the cohort does not")
    problems = []
    if not (ex.day_offset == ex.day - ex.first_day).all():
        problems.append("day_offset disagrees with the sessions' days")
    if not (ex.hour_of_day == ex.hour).all():
        problems.append("hour_of_day disagrees")
    if problems:
        raise SystemExit("; ".join(problems))
    out = ex[["patient_idx", "session_idx", "day", "hour_of_day", "game_id", "target", "raw", "confidence", "completed", "abandoned"]]
    return out.rename(columns={"hour_of_day": "hour"}).sort_values(["patient_idx", "session_idx", "target"]).reset_index(drop=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument("--hash-map", type=Path, required=True)
    ap.add_argument("--cohort", type=Path, required=True, help="the directory simulate.py wrote (the fixture)")
    a = ap.parse_args()

    export = read_export(a.csv)
    hash_map = json.loads(a.hash_map.read_text(encoding="utf-8"))
    cohort = simulate.load_cohort(a.cohort)
    print(f"export: {len(export)} rows, {export.patient_hash.nunique()} patients; cohort: {len(cohort.contributions)} contributions")

    original = cohort.contributions.sort_values(["patient_idx", "session_idx", "target"]).reset_index(drop=True)
    exported = attach(cohort, export, hash_map)

    failures = []
    if len(exported) != len(original):
        failures.append(f"row count {len(exported)} != {len(original)}")
    else:
        for col in ("raw", "confidence"):
            if np.abs(exported[col].to_numpy() - original[col].to_numpy()).max() > 1e-9:
                failures.append(f"{col} differs after the round trip")
        for col in ("patient_idx", "session_idx", "target", "game_id", "completed", "abandoned", "day"):
            if not (exported[col].to_numpy() == original[col].to_numpy()).all():
                failures.append(f"{col} differs after the round trip")

    # the same analysis on both, and the answers compared
    truth = R.Truth.of(cohort)
    results = {}
    for name, table in (("cohort", original), ("export", exported)):
        frame = replay_frame(table)
        index = SequenceIndex.of(frame)
        score = R.alarm_scores(frame, index, "R2")
        pp = R.evaluate_fires(frame, index, score >= R.DEFAULT_THRESHOLD["R2"], truth)
        results[name] = {"frame": frame, **R.metrics(pp)}
    same_frame = results["cohort"]["frame"].drop(columns=[]).equals(results["export"]["frame"])
    if not same_frame:
        failures.append("the engine replay differs between the cohort and the export")
    for k, v in results["cohort"].items():
        if k != "frame" and not (v == results["export"][k] or (np.isnan(v) and np.isnan(results["export"][k]))):
            failures.append(f"metric {k}: {v} vs {results['export'][k]}")

    swapped = simulate.Cohort(cohort.params, cohort.patients, cohort.truth, cohort.sessions, exported, cohort.latent)
    sd_a = sundowning.evaluations(cohort, min_per_part=3)
    sd_b = sundowning.evaluations(swapped, min_per_part=3)
    try:  # the same numbers; summing a session's scores in a different order may differ in the last digit
        pd.testing.assert_frame_equal(sd_a, sd_b, check_exact=False, atol=1e-9, rtol=0)
    except AssertionError as err:
        failures.append(f"the sundowning evaluation differs between the cohort and the export: {str(err)[:120]}")

    summary = pd.DataFrame([{"source": k, **{m: v for m, v in r.items() if m != "frame"}} for k, r in results.items()])
    save_table(summary, "export_check.csv")
    print(summary[["source", "sens_30d", "sens_90d", "median_delay_days", "false_alarms_per_patient_year_stable"]].to_string(index=False))
    if failures:
        print("FAILED:", *failures, sep="\n  - ")
        return 1
    print(f"OK: {len(export)} exported rows reproduce the cohort exactly, and the evaluation gives identical results on both.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
