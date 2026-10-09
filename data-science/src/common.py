"""Shared plumbing: where results go, the cohort every script uses, one look for every figure."""

from __future__ import annotations

import hashlib
import json
import os
import pickle
import platform
from dataclasses import asdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from params import SimParams  # noqa: E402
import simulate  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RESULTS = Path(os.environ.get("SMARAN_DS_RESULTS", ROOT / "results"))
FIGURES = RESULTS / "figures"
OUT = ROOT / "out"
N_BOOT = int(os.environ.get("SMARAN_DS_BOOT", "1000"))

COLORS = {"R0": "#8c6d46", "R1": "#c4572d", "R2": "#2f6f73", "R3": "#5a4e9c"}
PALETTE = ["#2f6f73", "#c4572d", "#5a4e9c", "#8c6d46", "#6a9a3a", "#aa3a63"]


def params_from_env() -> SimParams:
    """SMARAN_DS_SMALL=1 (the CI job) selects the cut-down cohort."""
    p = SimParams()
    return p.small() if os.environ.get("SMARAN_DS_SMALL") else p


def params_key(p: SimParams) -> str:
    return hashlib.sha256(json.dumps(asdict(p), sort_keys=True).encode()).hexdigest()[:12]


def get_cohort(p: SimParams | None = None, cache: bool = True) -> simulate.Cohort:
    """The cohort for `p`, simulated once and kept under out/ (not committed) so ten scripts do not repeat it."""
    p = p or params_from_env()
    path = OUT / f"cohort-{params_key(p)}.pkl"
    if cache and path.exists():
        with open(path, "rb") as f:
            return pickle.load(f)
    cohort = simulate.simulate(p)
    if cache:
        OUT.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(cohort, f)
    return cohort


def save_table(df: pd.DataFrame, name: str, digits: int = 4) -> Path:
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / name
    df.round(digits).to_csv(path, index=False)
    print(f"  {path.relative_to(ROOT.parent) if path.is_relative_to(ROOT.parent) else path}  ({len(df)} rows)")
    return path


def save_figure(fig, name: str, meta: dict | None = None) -> Path:
    """PNG plus a sidecar JSON with the seed and parameters it was made from."""
    FIGURES.mkdir(parents=True, exist_ok=True)
    path = FIGURES / name
    fig.savefig(path, dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    sidecar = path.with_suffix(".json")
    sidecar.write_text(json.dumps(meta or {}, indent=2, default=str), encoding="utf-8")
    print(f"  {path.relative_to(ROOT.parent) if path.is_relative_to(ROOT.parent) else path}")
    return path


def style() -> None:
    plt.rcParams.update(
        {
            "figure.dpi": 100,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.alpha": 0.25,
            "axes.titlesize": 11,
            "axes.labelsize": 10,
            "legend.frameon": False,
            "font.size": 9.5,
        }
    )


def fig_meta(p: SimParams, **extra) -> dict:
    return {"seed": p.seed, "n_patients": p.n_patients, "days": p.days, "bootstrap_resamples": N_BOOT, **extra}


def run_info(p: SimParams) -> dict:
    import matplotlib as mpl
    import scipy
    import sklearn

    info = {
        "seed": p.seed,
        "n_patients": p.n_patients,
        "days": p.days,
        "bootstrap_resamples": N_BOOT,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scipy": scipy.__version__,
        "scikit-learn": sklearn.__version__,
        "matplotlib": mpl.__version__,
    }
    try:
        import statsmodels

        info["statsmodels"] = statsmodels.__version__
    except ImportError:
        pass
    return info


style()
