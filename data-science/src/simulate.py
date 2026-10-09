"""A synthetic cohort with known ground truth.

For each patient the simulator first decides what is *true* (her ability in each
of the six domains, every day, including when it started to change), and only
then what the games *saw* (her ability plus a practice curve, the day's
mood, how hard that game is, a late-day dip if she has one, and noise). The
evaluation can therefore ask of an alert rule: did you fire when something had
really changed, and stay quiet when it had not?

Everything a run needs is in `SimParams` (params.py); every number there is an
assumption, listed with its reason in data-science/README.md. A run is fully
determined by `SimParams.seed`: each patient has her own generator, so patient
7 is the same patient whatever the size of the cohort.

Outputs (`write_cohort`):

  envelopes.json   the JSON the API ingests (SessionEnvelope), per patient
  contributions.csv  de-identified, one row per (session, domain), no ground truth
  sessions.csv       one row per session with the behavioural features
  ground_truth.csv   trajectory, onset day and rate per patient and domain (analysis only)
  latent.csv         true ability per patient, domain and day (analysis only; not committed for the full cohort)

Run:  python src/simulate.py --out out/cohort [--small] [--n 200] [--seed ...]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from params import SimParams
from scoring_core import DOMAIN_IDS, ENGINE_VERSION

REPO = Path(__file__).resolve().parents[2]
REGISTRY = REPO / "backend" / "src" / "main" / "resources" / "game-registry.json"

TRAJECTORIES = ("stable", "slow_decline", "fast_decline", "single_domain", "improving")
DOMAIN_INDEX = {d: i for i, d in enumerate(DOMAIN_IDS)}
IST = timezone(timedelta(hours=5, minutes=30))
NAMESPACE = uuid.UUID("5a6a7261-6e00-4000-8000-0000000d5c1e")  # "Smaran" cohort ids

LOW_MOODS = ("A_LITTLE_LOW", "WORRIED", "RESTLESS")
OK_MOODS = ("JOYFUL", "PEACEFUL", "QUIET", "SLEEPY")


@dataclass(frozen=True)
class Game:
    id: str
    primary: tuple
    secondary: tuple

    @property
    def targets(self) -> tuple:
        return self.primary + self.secondary


def load_games(path: Path = REGISTRY) -> list[Game]:
    """The games a patient can play, from the server's own registry (so a simulated session is one the server accepts)."""
    registry = json.loads(path.read_text(encoding="utf-8"))
    games = []
    for g in registry["games"]:
        if g.get("retired") or g["id"] == "journal":
            continue
        domains = [t for t in g["targets"] if t in DOMAIN_INDEX]
        primary = tuple(d for d in g["primaryDomains"] if d in domains)
        secondary = tuple(d for d in domains if d not in primary)
        games.append(Game(g["id"], primary, secondary))
    return games


@dataclass
class Cohort:
    params: SimParams
    patients: pd.DataFrame
    truth: pd.DataFrame
    sessions: pd.DataFrame
    contributions: pd.DataFrame
    latent: np.ndarray  # (patients, days, 6)

    def patient_id(self, idx: int) -> str:
        return f"sim-{idx + 1:04d}"


def _assign_trajectories(p: SimParams, rng: np.random.Generator) -> list[str]:
    shares = [p.p_stable, p.p_slow_decline, p.p_fast_decline, p.p_single_domain, p.p_improving]
    counts = [int(round(p.n_patients * s)) for s in shares]
    counts[0] += p.n_patients - sum(counts)  # rounding goes to the stable group
    kinds = [t for t, c in zip(TRAJECTORIES, counts) for _ in range(c)]
    rng.shuffle(kinds)
    return kinds


def _game_bias(p: SimParams, games: list[Game]) -> dict:
    """How hard each game is on each domain, fixed for everyone (it depends on the seed only)."""
    rng = np.random.default_rng(np.random.SeedSequence([p.seed, 7001]))
    return {(g.id, t): float(rng.normal(0, p.game_bias_sd)) for g in games for t in g.targets}


def _latent_curve(base: float, onset: int | None, rate: float, cap: float, direction: int, days: int) -> np.ndarray:
    d = np.arange(days, dtype=float)
    if onset is None or direction == 0:
        return np.full(days, base)
    moved = np.minimum(cap, rate * np.maximum(0.0, d - onset))
    return np.clip(base + direction * moved, 5.0, 98.0)


def _hour(rng: np.random.Generator, p: SimParams) -> int:
    u = rng.random()
    if u < p.p_morning:
        return int(rng.integers(7, 12))
    if u < p.p_morning + p.p_midday:
        return int(rng.integers(12, 15))
    if u < p.p_morning + p.p_midday + p.p_afternoon:
        return int(rng.integers(15, 20))
    return int(rng.integers(20, 22))


def _times_of_day(rng: np.random.Generator, p: SimParams, n: int) -> list[tuple[int, int]]:
    """n distinct, increasing (hour, minute) times in one day: two sittings never share a minute, so (patient, start) is a key."""
    minutes = sorted(_hour(rng, p) * 60 + int(rng.integers(0, 60)) for _ in range(n))
    out, last = [], -1
    for t in minutes:
        t = max(t, last + 1)
        out.append((t // 60, t % 60))
        last = t
    return out


def _beta_with_mean(rng: np.random.Generator, mean: float, concentration: float = 4.0) -> float:
    return float(rng.beta(mean * concentration, (1 - mean) * concentration))


def simulate(params: SimParams | None = None, games: list[Game] | None = None) -> Cohort:
    p = params or SimParams()
    p.check()
    games = games or load_games()
    bias = _game_bias(p, games)
    master = np.random.default_rng(np.random.SeedSequence([p.seed, 1]))
    kinds = _assign_trajectories(p, master)

    patient_rows, truth_rows, session_rows, contribution_rows = [], [], [], []
    latent_all = np.zeros((p.n_patients, p.days, len(DOMAIN_IDS)))
    session_counter = 0

    for i, kind in enumerate(kinds):
        rng = np.random.default_rng(np.random.SeedSequence([p.seed, 2, i]))

        # ---- who she is -------------------------------------------------------
        centre = rng.normal(p.level_mean, p.level_sd_between)
        base = np.clip(centre + rng.normal(0, p.level_sd_domain, len(DOMAIN_IDS)), p.level_floor, p.level_ceiling)

        # ---- what changes, and when -------------------------------------------
        onset = {d: None for d in DOMAIN_IDS}
        direction = {d: 0 for d in DOMAIN_IDS}
        rate = {d: 0.0 for d in DOMAIN_IDS}
        cap = {d: 0.0 for d in DOMAIN_IDS}
        if kind != "stable":
            common_onset = int(rng.integers(p.onset_min_day, p.onset_max_day + 1))
            if kind == "single_domain":
                affected = [DOMAIN_IDS[int(rng.integers(0, len(DOMAIN_IDS)))]]
            else:
                affected = list(DOMAIN_IDS)
            kind_rate, kind_cap, kind_dir = {
                "slow_decline": (p.slow_rate, p.slow_max_drop, -1),
                "fast_decline": (p.fast_rate, p.fast_max_drop, -1),
                "single_domain": (p.single_rate, p.single_max_drop, -1),
                "improving": (p.improve_rate, p.improve_max_gain, +1),
            }[kind]
            for d in affected:
                jitter = int(rng.integers(-p.onset_jitter_days, p.onset_jitter_days + 1))
                onset[d] = int(np.clip(common_onset + jitter, p.onset_min_day // 2, p.days - 30))
                direction[d] = kind_dir
                rate[d] = kind_rate * float(rng.uniform(1 - p.rate_jitter, 1 + p.rate_jitter))
                cap[d] = kind_cap

        latent = np.stack(
            [_latent_curve(base[k], onset[d], rate[d], cap[d], direction[d], p.days) for k, d in enumerate(DOMAIN_IDS)],
            axis=1,
        )
        latent_all[i] = latent

        # ---- how she tends to be ----------------------------------------------
        sundowner = bool(rng.random() < p.sundowner_share)
        sundown_pts = float(rng.uniform(p.sundown_lo, p.sundown_hi)) if sundowner else 0.0
        afternoon_pts = 0.0 if sundowner else float(rng.normal(0, p.afternoon_sd_others))
        prefs = rng.dirichlet(np.full(len(games), 2.0))
        practice_max = {g.id: float(np.clip(rng.normal(p.practice_max_mean, p.practice_max_sd), 2, 20)) for g in games}
        practice_tau = {g.id: float(rng.lognormal(math.log(p.practice_tau_median), p.practice_tau_sigma)) for g in games}
        lapse_start = _beta_with_mean(rng, p.lapse_start_mean)
        lapse_end = _beta_with_mean(rng, p.lapse_end_mean)
        dropout_day = int(rng.integers(p.days // 2, p.days)) if rng.random() < p.dropout_share else None
        abandon_b0 = float(rng.normal(p.abandon_logit_mean, p.abandon_logit_sd))
        latency_offset = float(rng.normal(0, 0.08))
        hesitation_offset = float(rng.normal(0, 0.05))
        tier_pref = rng.dirichlet(np.array([3.0, 4.5, 2.5]))

        patient_rows.append(
            dict(
                patient_idx=i,
                patient_id=f"sim-{i + 1:04d}",
                trajectory=kind,
                sundowner=sundowner,
                sundown_points=sundown_pts,
                dropout_day=dropout_day if dropout_day is not None else np.nan,
                level_mean=float(base.mean()),
            )
        )
        for k, d in enumerate(DOMAIN_IDS):
            truth_rows.append(
                dict(
                    patient_idx=i,
                    domain=d,
                    base_level=float(base[k]),
                    onset_day=onset[d] if onset[d] is not None else np.nan,
                    direction=direction[d],
                    rate_per_day=rate[d],
                    max_change=cap[d],
                )
            )

        # ---- the days ---------------------------------------------------------
        day_effect = rng.normal(0, p.day_sd)
        active = True
        played = {g.id: 0 for g in games}
        prev_abandoned = False
        recent: list[float] = []
        seq = 0
        sd_innov = p.day_sd * math.sqrt(1 - p.day_phi**2)
        for day in range(p.days):
            day_effect = p.day_phi * day_effect + rng.normal(0, sd_innov)
            if active:
                active = rng.random() >= lapse_start
            else:
                active = rng.random() < lapse_end
            if not active or (dropout_day is not None and day >= dropout_day):
                continue
            n_today = 1 + min(2, int(rng.poisson(p.sessions_extra_mean)))
            for hour, minute in _times_of_day(rng, p, n_today):
                g = games[int(rng.choice(len(games), p=prefs))]
                late = 15 <= hour <= 19
                mood_low = bool(rng.random() < (0.20 + (0.10 if late else 0.0)))
                tier = int(rng.choice([1, 2, 3], p=tier_pref))

                recent_mean = float(np.mean(recent[-3:])) if recent else 55.0
                z = (
                    abandon_b0
                    + (p.abandon_late_effect + (p.abandon_sundown_extra if sundowner else 0.0)) * late
                    + p.abandon_after_abandon * prev_abandoned
                    + p.abandon_low_recent * max(0.0, (55.0 - recent_mean) / 10.0)
                    + p.abandon_low_mood * mood_low
                    + p.abandon_tier * (tier - 2)
                )
                abandoned = bool(rng.random() < 1 / (1 + math.exp(-z)))

                k_played = played[g.id]
                practice = practice_max[g.id] * (1 - math.exp(-k_played / practice_tau[g.id]))
                played[g.id] += 1
                dip = -sundown_pts if (late and sundowner) else (afternoon_pts if late else 0.0)
                conf_draw = (
                    rng.uniform(p.abandoned_conf_lo, p.abandoned_conf_hi) if abandoned else rng.uniform(p.conf_lo, p.conf_hi)
                )

                primary_latent = float(np.mean([latent[day, DOMAIN_INDEX[t]] for t in g.primary]))
                for target in g.targets:
                    is_primary = target in g.primary
                    sd = p.noise_sd_primary if is_primary else p.noise_sd_secondary
                    if abandoned:
                        sd *= p.abandoned_noise_mult
                    lat = float(latent[day, DOMAIN_INDEX[target]])
                    raw = lat + practice + bias[(g.id, target)] + day_effect + dip + rng.normal(0, sd)
                    if abandoned:
                        raw += p.abandoned_shift
                    raw = round(float(np.clip(raw, 0, 100)), 1)
                    conf = conf_draw * (1.0 if (is_primary or abandoned) else p.conf_secondary_mult)
                    contribution_rows.append(
                        dict(
                            session_idx=session_counter,
                            patient_idx=i,
                            day=day,
                            hour=hour,
                            game_id=g.id,
                            target=target,
                            is_primary=is_primary,
                            raw=raw,
                            confidence=round(float(conf), 2),
                            latent=round(lat, 3),
                            practice=round(practice, 3),
                            completed=not abandoned,
                            abandoned=abandoned,
                        )
                    )
                    if is_primary:
                        recent.append(raw)

                latency = float(np.clip(0.35 + (65.0 - primary_latent) / 150.0 + latency_offset + rng.normal(0, 0.05), 0, 1))
                hesitation = float(
                    np.clip(0.15 + (60.0 - primary_latent) / 200.0 + hesitation_offset + (0.08 if late and sundowner else 0.0)
                            + rng.normal(0, 0.05), 0, 1)
                )
                completion = float(rng.uniform(0.2, 0.6) if abandoned else rng.uniform(0.85, 1.0))
                session_rows.append(
                    dict(
                        session_idx=session_counter,
                        patient_idx=i,
                        patient_seq=seq,
                        day=day,
                        hour=hour,
                        minute=minute,
                        game_id=g.id,
                        completed=not abandoned,
                        abandoned=abandoned,
                        practice_index=k_played,
                        tier=tier,
                        mood_low=mood_low,
                        tap_latency_norm=round(latency, 4),
                        hesitation_rate=round(hesitation, 4),
                        completion_rate=round(completion, 4),
                        duration_s=int(rng.integers(20, 90)) if abandoned else int(np.clip(rng.normal(240, 60), 90, 600)),
                    )
                )
                prev_abandoned = abandoned
                session_counter += 1
                seq += 1

    cohort = Cohort(
        params=p,
        patients=pd.DataFrame(patient_rows),
        truth=pd.DataFrame(truth_rows),
        sessions=pd.DataFrame(session_rows),
        contributions=pd.DataFrame(contribution_rows),
        latent=latent_all,
    )
    return cohort


# ------------------------------------------------------------------ outputs


def pseudonym(salt: str, patient_id: str) -> str:
    """The de-identified patient key, the same construction as the API's export (HMAC-SHA256, first 16 hex)."""
    import hmac

    return hmac.new(salt.encode(), patient_id.encode(), hashlib.sha256).hexdigest()[:16]


def started_at(params: SimParams, day: int, hour: int, minute: int) -> datetime:
    """The instant a session began: local (IST) wall time, returned in UTC."""
    local = datetime.combine(date.fromisoformat(params.start_date) + timedelta(days=day), datetime.min.time(), tzinfo=IST)
    return (local + timedelta(hours=hour, minutes=minute)).astimezone(timezone.utc)


def to_envelopes(cohort: Cohort) -> list[dict]:
    """One entry per patient, each with her sessions as the exact JSON the ingestion API accepts."""
    p = cohort.params
    contributions: dict[int, list] = {}
    c = cohort.contributions
    for sid, target, raw, conf in zip(c.session_idx.to_numpy(), c.target.to_numpy(), c.raw.to_numpy(), c.confidence.to_numpy()):
        contributions.setdefault(int(sid), []).append(
            {"target": str(target), "raw": float(raw), "confidence": float(conf), "because": "Simulated session."}
        )
    patient_ids = cohort.patients.set_index("patient_idx").patient_id.to_dict()
    kinds = cohort.patients.set_index("patient_idx").trajectory.to_dict()
    per_patient: dict[int, list] = {i: [] for i in patient_ids}
    sessions = cohort.sessions.sort_values(["patient_idx", "patient_seq"])
    moods = np.random.default_rng(np.random.SeedSequence([p.seed, 3])).random(len(sessions))
    cols = ["session_idx", "patient_idx", "patient_seq", "day", "hour", "minute", "game_id", "completed", "abandoned",
            "tier", "mood_low", "duration_s"]
    for n, (sid, pi, seq, day, hour, minute, game, completed, abandoned, tier, mood_low, dur) in enumerate(
        zip(*(sessions[col].to_numpy() for col in cols))
    ):
        pool = LOW_MOODS if mood_low else OK_MOODS
        at = started_at(p, int(day), int(hour), int(minute))
        per_patient[int(pi)].append(
            {
                "clientSessionId": str(uuid.uuid5(NAMESPACE, f"{p.seed}:{int(pi)}:{int(seq)}")),
                "patientId": patient_ids[int(pi)],
                "gameId": str(game),
                "startedAt": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "durationMs": int(dur) * 1000,
                "completed": bool(completed),
                "abandoned": bool(abandoned),
                "hourOfDay": int(hour),
                "moodAtStart": pool[int(moods[n] * len(pool))],
                "difficulty": {"tier": int(tier), "params": {}},
                "trials": [],
                "contributions": contributions[int(sid)],
                "markers": None,
                # The simulator makes scores, not trials, so there is nothing for the server to
                # re-score: it replays these contributions as they are.
                "precomputedReading": True,
                "engineVersion": ENGINE_VERSION,
            }
        )
    return [{"patientId": patient_ids[i], "trajectory": kinds[i], "envelopes": per_patient[i]} for i in sorted(patient_ids)]


def deidentified_contributions(cohort: Cohort, salt: str = "simulated-cohort") -> pd.DataFrame:
    """The table the API's export produces, for the same cohort: no ids, no dates, no ground truth."""
    c = cohort.contributions.merge(
        cohort.sessions[["session_idx", "patient_seq", "minute", "tier", "mood_low"]], on="session_idx"
    )
    c["patient_hash"] = [pseudonym(salt, cohort.patient_id(i)) for i in c.patient_idx]
    weekday = (date.fromisoformat(cohort.params.start_date).weekday() + c.day) % 7
    out = pd.DataFrame(
        {
            "patient_hash": c.patient_hash,
            "session_seq": c.patient_seq,
            "day_offset": c.day,
            "weekday": weekday,
            "hour_of_day": c.hour,
            "game_id": c.game_id,
            "completed": c.completed,
            "abandoned": c.abandoned,
            "target": c.target,
            "raw": c.raw,
            "confidence": c.confidence,
        }
    )
    return out.sort_values(["patient_hash", "session_seq", "target"], kind="stable").reset_index(drop=True)


def fixture_params() -> SimParams:
    """Five patients, one on each trajectory, 120 days, declines starting early: small enough to commit and to load in a
    test (backend/src/test/resources/cohort), big enough that the engine opens real alerts for the decliners."""
    return SimParams(n_patients=5, days=120, p_stable=0.2, p_slow_decline=0.2, p_fast_decline=0.2, p_single_domain=0.2,
                     p_improving=0.2, onset_min_day=40, onset_max_day=70, dropout_share=0.0)


def _text(path: Path, text: str) -> None:
    """Same bytes on every platform: LF line endings, UTF-8."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def _csv(df: pd.DataFrame, path: Path) -> None:
    _text(path, df.to_csv(index=False, lineterminator="\n"))


def write_cohort(cohort: Cohort, out: Path, with_latent: bool = True) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    p = cohort.params
    envelopes = to_envelopes(cohort)
    meta = {
        "engineVersion": ENGINE_VERSION,
        "seed": p.seed,
        "patients": p.n_patients,
        "days": p.days,
        "startDate": p.start_date,
        "note": "Synthetic. Generated by data-science/src/simulate.py. Scores are simulated, not played.",
    }
    _text(out / "envelopes.json", json.dumps({"cohort": meta, "patients": envelopes}, separators=(",", ":")))
    _csv(deidentified_contributions(cohort), out / "contributions.csv")
    _csv(cohort.sessions, out / "sessions.csv")
    _csv(cohort.contributions, out / "cohort_contributions.csv")
    _csv(cohort.patients, out / "patients.csv")
    _csv(cohort.truth, out / "ground_truth.csv")
    _text(out / "params.json", json.dumps(p.__dict__, indent=2, default=str))
    if with_latent:
        rows = []
        for i in range(p.n_patients):
            for k, d in enumerate(DOMAIN_IDS):
                rows.append(pd.DataFrame({"patient_idx": i, "domain": d, "day": np.arange(p.days), "latent": cohort.latent[i, :, k].round(3)}))
        text = pd.concat(rows).to_csv(index=False, lineterminator="\n")
        _text(out / "latent.csv", text)  # plain text: compressed bytes differ between platforms and zlib versions
    return meta


def load_cohort(directory: Path) -> Cohort:
    """Read back what `write_cohort` wrote (with the latent curves), for analysis of a cohort held on disk."""
    d = Path(directory)
    p = SimParams(**json.loads((d / "params.json").read_text(encoding="utf-8")))
    latent = np.zeros((p.n_patients, p.days, len(DOMAIN_IDS)))
    lat = pd.read_csv(d / "latent.csv")
    for k, dom in enumerate(DOMAIN_IDS):
        part = lat[lat.domain == dom].sort_values(["patient_idx", "day"])
        latent[:, :, k] = part.latent.to_numpy().reshape(p.n_patients, p.days)
    return Cohort(
        params=p,
        patients=pd.read_csv(d / "patients.csv"),
        truth=pd.read_csv(d / "ground_truth.csv"),
        sessions=pd.read_csv(d / "sessions.csv"),
        contributions=pd.read_csv(d / "cohort_contributions.csv"),
        latent=latent,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path("out/cohort"))
    ap.add_argument("--small", action="store_true", help="the cut-down cohort the CI job uses")
    ap.add_argument("--n", type=int)
    ap.add_argument("--days", type=int)
    ap.add_argument("--seed", type=int)
    ap.add_argument("--no-latent", action="store_true")
    ap.add_argument("--fixture", action="store_true", help="write the five-patient test fixture to --out")
    a = ap.parse_args()
    params = fixture_params() if a.fixture else SimParams()
    if a.small:
        params = params.small()
    changes = {k: v for k, v in (("n_patients", a.n), ("days", a.days), ("seed", a.seed)) if v is not None}
    if changes:
        from dataclasses import replace

        params = replace(params, **changes)
    cohort = simulate(params)
    meta = write_cohort(cohort, a.out, with_latent=not a.no_latent)
    n_sessions = len(cohort.sessions)
    print(f"wrote {a.out}: {params.n_patients} patients, {n_sessions} sessions, {len(cohort.contributions)} contributions  {meta['seed']=}")


if __name__ == "__main__":
    main()
