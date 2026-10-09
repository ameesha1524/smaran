"""Federated learning, simulated: can a small head learn who is about to abandon a session without the data leaving the tablet?

The head is the one in frontend/src/lib/federated.ts: logistic regression on the same six features
(tap latency, hesitation, completion of the last session, difficulty tier, hour, low mood), trained by the
same full-batch gradient descent (24 epochs, learning rate 0.28, L2 0.01), with the same FedAvg weighting by
sample count that backend/.../FederatedAggregationService.java describes. One difference: the tablet's
label today is "did the session go well"; here it is "will this session be left unfinished", which is what
the specification asks to be predicted. The shape is identical.

Patients are not alike (some leave often, some never; the simulator draws each one's rate, speed and hours
separately), so the data is non-IID, which is the case that makes federated averaging hard.

Compared, on each patient's last 30% of sessions (the first 70% train):
  local only   each patient trains alone on her own history
  centralised  everyone's training data pooled (what federation avoids)
  FedAvg       clients train locally from the global weights, the server averages the updates
  FedAvg + tune  FedAvg, then each client trains a few more rounds on her own data
Also evaluated on patients who never took part (the cold start).

NOT implemented, and it matters: secure aggregation. Here, as in the app today, the server could see each
client's update on its own. The last table shows what one round-one update gives away.

Writes results/fl_*.csv and results/figures/fl.png.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from common import COLORS, N_BOOT, fig_meta, get_cohort, params_from_env, save_figure, save_table

EPOCHS = 24          # per round, as federated.ts fit()
LR = 0.28
L2 = 0.01
ROUNDS = 60
FINE_TUNE_ROUNDS = 5
TRAIN_SHARE = 0.70
FEATURES = ["medianTapLatencyNorm", "hesitationRate", "completionRate", "difficultyTier", "hourOfDayNorm", "moodLow"]


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def local_fit(w: np.ndarray, b: float, X: np.ndarray, y: np.ndarray, epochs: int = EPOCHS, lr: float = LR):
    """federated.ts `fit`: full-batch gradient descent, L2 on the weights only."""
    w = w.copy()
    for _ in range(epochs):
        err = sigmoid(X @ w + b) - y
        w -= lr * (X.T @ err / len(y) + L2 * w)
        b -= lr * err.mean()
    return w, b


def log_loss(w, b, X, y):
    p = np.clip(sigmoid(X @ w + b), 1e-9, 1 - 1e-9)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


def auc(score: np.ndarray, y: np.ndarray) -> float:
    from scipy.stats import rankdata
    n1 = int(y.sum())
    n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return float("nan")
    ranks = rankdata(score)
    return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def build_clients(cohort) -> list[dict]:
    """Per patient: training and test rows. Features come from the previous session and this session's set-up."""
    s = cohort.sessions.sort_values(["patient_idx", "patient_seq"])
    clients = []
    for patient, g in s.groupby("patient_idx"):
        if len(g) < 40:
            continue
        prev = g.shift(1).iloc[1:]
        cur = g.iloc[1:]
        X = np.column_stack([
            prev.tap_latency_norm, prev.hesitation_rate, prev.completion_rate,
            cur.tier / 3.0, cur.hour / 24.0, cur.mood_low.astype(float),
        ])
        y = cur.abandoned.to_numpy().astype(float)
        cut = int(len(y) * TRAIN_SHARE)
        clients.append({"patient": int(patient), "Xtr": X[:cut], "ytr": y[:cut], "Xte": X[cut:], "yte": y[cut:]})
    return clients


def fedavg_round(w, b, clients, rng, participation: float):
    chosen = clients if participation >= 1 else [c for c in clients if rng.random() < participation] or [clients[0]]
    total = sum(len(c["ytr"]) for c in chosen)
    dw, db = np.zeros_like(w), 0.0
    for c in chosen:
        w2, b2 = local_fit(w, b, c["Xtr"], c["ytr"])
        weight = len(c["ytr"]) / total
        dw += weight * (w2 - w)
        db += weight * (b2 - b)
    return w + dw, b + db, len(chosen)


def pooled(clients, which: str):
    X = np.vstack([c[f"X{which}"] for c in clients])
    y = np.concatenate([c[f"y{which}"] for c in clients])
    return X, y


def evaluate(models: dict, clients) -> dict:
    """Pooled AUC and log-loss over the clients' test rows; models maps patient -> (w, b)."""
    scores, ys, losses = [], [], []
    for c in clients:
        w, b = models[c["patient"]]
        scores.append(sigmoid(c["Xte"] @ w + b))
        ys.append(c["yte"])
        losses.append(log_loss(w, b, c["Xte"], c["yte"]))
    score, y = np.concatenate(scores), np.concatenate(ys)
    return {"auc": auc(score, y), "log_loss": float(np.average(losses, weights=[len(v) for v in ys])), "test_rows": int(len(y)),
            "test_abandon_rate": float(y.mean())}


def comm_bytes(dw: np.ndarray, db: float) -> int:
    """What one update costs on the wire as federated.ts sends it: JSON with six-decimal numbers, AES-GCM (12 byte IV
    + 16 byte tag), then base64."""
    payload = json.dumps({"dw": [round(float(x), 6) for x in dw], "db": round(float(db), 6)}, separators=(",", ":"))
    return int(math.ceil((len(payload) + 28) / 3) * 4)


def main() -> None:
    p = params_from_env()
    cohort = get_cohort(p)
    rng = np.random.default_rng(np.random.SeedSequence([p.seed, 51]))
    clients = build_clients(cohort)
    order = rng.permutation(len(clients))
    n_hold = max(5, len(clients) // 5)
    held = [clients[i] for i in order[:n_hold]]
    federation = [clients[i] for i in order[n_hold:]]
    d = len(FEATURES)
    print(f"federated simulation: {len(federation)} clients, {len(held)} held-out patients")

    # ---- how non-IID --------------------------------------------------------------------
    rates = np.array([c["ytr"].mean() for c in federation])
    lat = np.array([c["Xtr"][:, 0].mean() for c in federation])
    noniid = pd.DataFrame([{
        "clients": len(federation),
        "abandon_rate_mean": rates.mean(), "abandon_rate_sd_between_patients": rates.std(ddof=1),
        "abandon_rate_min": rates.min(), "abandon_rate_max": rates.max(),
        "tap_latency_mean_sd_between_patients": lat.std(ddof=1),
        "train_rows_total": sum(len(c["ytr"]) for c in federation),
        "train_rows_per_client_median": float(np.median([len(c["ytr"]) for c in federation])),
    }])
    save_table(noniid, "fl_noniid.csv")

    base_rate = float(np.concatenate([c["ytr"] for c in federation]).mean())
    zero = {c["patient"]: (np.zeros(d), math.log(base_rate / (1 - base_rate))) for c in federation}
    reference = evaluate(zero, federation)

    # ---- the four training schemes, round by round ----------------------------------------------
    curves = []

    def record(method, rnd, models, held_models=None, comm=0):
        e = evaluate(models, federation)
        row = {"method": method, "round": rnd, "auc": e["auc"], "log_loss": e["log_loss"], "cumulative_bytes": comm}
        if held_models is not None:
            h = evaluate(held_models, held)
            row.update({"new_patient_auc": h["auc"], "new_patient_log_loss": h["log_loss"]})
        curves.append(row)

    ids = [c["patient"] for c in federation]
    held_ids = [c["patient"] for c in held]

    # local only: each client alone, ROUNDS x 24 epochs
    local = {c["patient"]: (np.zeros(d), 0.0) for c in federation}
    record("local only", 0, local)
    for r in range(1, ROUNDS + 1):
        for c in federation:
            w, b = local[c["patient"]]
            local[c["patient"]] = local_fit(w, b, c["Xtr"], c["ytr"])
        if r % 2 == 0 or r == 1:
            record("local only", r, local)

    # centralised: the pooled data, the same optimiser and budget
    X, y = pooled(federation, "tr")
    w, b = np.zeros(d), 0.0
    central_bytes = int(sum(len(json.dumps([round(float(v), 4) for v in row] + [int(t)], separators=(",", ":"))) + 1
                            for row, t in zip(X[::25], y[::25])) * 25)  # row-sampled estimate of the pooled upload
    record("centralised", 0, {i: (w, b) for i in ids}, {i: (w, b) for i in held_ids}, central_bytes)
    for r in range(1, ROUNDS + 1):
        w, b = local_fit(w, b, X, y)
        if r % 2 == 0 or r == 1:
            record("centralised", r, {i: (w, b) for i in ids}, {i: (w, b) for i in held_ids}, central_bytes)
    central = (w, b)

    # FedAvg, full participation and a quarter of the clients each round
    finals = {}
    for label, part in (("FedAvg (all clients)", 1.0), ("FedAvg (25% per round)", 0.25)):
        w, b = np.zeros(d), 0.0
        total_bytes = 0
        record(label, 0, {i: (w, b) for i in ids}, {i: (w, b) for i in held_ids}, 0)
        for r in range(1, ROUNDS + 1):
            w_new, b_new, k = fedavg_round(w, b, federation, rng, part)
            per_update = comm_bytes(w_new - w, b_new - b)
            total_bytes += k * (per_update + per_update)   # each participant uploads one update and downloads the model
            w, b = w_new, b_new
            if r % 2 == 0 or r == 1:
                record(label, r, {i: (w, b) for i in ids}, {i: (w, b) for i in held_ids}, total_bytes)
        finals[label] = (w, b, total_bytes)

    # FedAvg then a little local training: personalisation
    w, b, _ = finals["FedAvg (all clients)"]
    tuned = {}
    for c in federation:
        wi, bi = w.copy(), b
        for _ in range(FINE_TUNE_ROUNDS):
            wi, bi = local_fit(wi, bi, c["Xtr"], c["ytr"])
        tuned[c["patient"]] = (wi, bi)
    record("FedAvg + local tuning", ROUNDS, tuned, None, finals["FedAvg (all clients)"][2])
    curve_df = pd.DataFrame(curves)
    save_table(curve_df, "fl_convergence.csv")

    # ---- the final table ---------------------------------------------------------------------------
    summary = []

    def final_row(name, models, held_models, nbytes, note):
        e = evaluate(models, federation)
        row = {"method": name, "auc": e["auc"], "log_loss": e["log_loss"], "bytes_on_the_wire": nbytes, "note": note}
        if held_models is not None:
            h = evaluate(held_models, held)
            row.update({"new_patient_auc": h["auc"], "new_patient_log_loss": h["log_loss"]})
        summary.append(row)

    summary.append({"method": "predict the base rate for everyone", "auc": 0.5, "log_loss": reference["log_loss"], "bytes_on_the_wire": 0,
                    "note": f"the test abandonment rate is {reference['test_abandon_rate']:.3f}"})
    final_row("local only", local, None, 0, "no data leaves; cannot serve a new patient")
    final_row("centralised", {i: central for i in ids}, {i: central for i in held_ids}, central_bytes,
              "every training row uploaded once (estimated)")
    for label, (w, b, nb) in finals.items():
        final_row(label, {i: (w, b) for i in ids}, {i: (w, b) for i in held_ids}, nb, f"{ROUNDS} rounds, update plus model download")
    final_row("FedAvg + local tuning", tuned, None, finals["FedAvg (all clients)"][2], f"{FINE_TUNE_ROUNDS} extra local rounds, no extra traffic")
    save_table(pd.DataFrame(summary), "fl_summary.csv")

    # ---- what a single update gives away --------------------------------------------------------------
    first = []
    for c in federation:
        w2, b2 = local_fit(np.zeros(d), 0.0, c["Xtr"], c["ytr"])
        first.append({"abandon_rate": float(c["ytr"].mean()), "db": b2, "dw_norm": float(np.linalg.norm(w2))})
    f = pd.DataFrame(first)
    r_db = float(np.corrcoef(f.abandon_rate, f.db)[0, 1])
    boots = []
    for _ in range(N_BOOT):
        i = rng.integers(0, len(f), len(f))
        boots.append(np.corrcoef(f.abandon_rate.to_numpy()[i], f.db.to_numpy()[i])[0, 1])
    leak = pd.DataFrame([{
        "what": "correlation between a client's first-round bias update and her true abandonment rate",
        "pearson_r": r_db, "lo": np.percentile(boots, 2.5), "hi": np.percentile(boots, 97.5), "clients": len(f),
        "reading": "one update, seen alone by the server, gives away how often she leaves sessions unfinished",
    }])
    save_table(leak, "fl_leakage.csv")

    # ---- figure -------------------------------------------------------------------------------------------
    fig, axes = plt.subplots(1, 3, figsize=(14.5, 4.2))
    colour = {"local only": "#8c6d46", "centralised": "#333", "FedAvg (all clients)": COLORS["R2"],
              "FedAvg (25% per round)": COLORS["R3"]}
    ax = axes[0]
    for m, c in colour.items():
        d_ = curve_df[curve_df.method == m]
        ax.plot(d_["round"], d_.log_loss, color=c, label=m)
    ax.axhline(reference["log_loss"], color="#bbb", ls=":", lw=1, label="base rate")
    ax.set_xlabel("Round (24 local epochs each)")
    ax.set_ylabel("Held-out log-loss (training patients)")
    ax.set_title("A. Convergence")
    ax.legend(fontsize=8)

    ax = axes[1]
    sdf = pd.DataFrame(summary)
    sdf = sdf[sdf.method != "predict the base rate for everyone"]
    x = np.arange(len(sdf))
    ax.bar(x, sdf.auc, color=["#8c6d46", "#333", COLORS["R2"], COLORS["R3"], COLORS["R1"]][: len(sdf)])
    ax.set_xticks(x)
    ax.set_xticklabels([m.replace(" (", "\n(").replace(" + ", "\n+ ") for m in sdf.method], fontsize=7.5)
    ax.set_ylim(0.5, max(0.8, sdf.auc.max() + 0.03))
    ax.set_ylabel("Held-out AUC")
    ax.set_title("B. Who predicts best")

    ax = axes[2]
    for m in ("FedAvg (all clients)", "FedAvg (25% per round)"):
        d_ = curve_df[curve_df.method == m]
        ax.plot(d_.cumulative_bytes / 1e6, d_.log_loss, color=colour[m], label=m)
    ax.axvline(central_bytes / 1e6, color="#333", ls="--", lw=1, label="centralised: upload every row once")
    ax.set_xlabel("Megabytes on the wire, all clients")
    ax.set_ylabel("Held-out log-loss")
    ax.set_title("C. Communication cost")
    ax.legend(fontsize=8)
    save_figure(fig, "fl.png", fig_meta(p, rounds=ROUNDS, epochs=EPOCHS, lr=LR, l2=L2))


if __name__ == "__main__":
    main()
