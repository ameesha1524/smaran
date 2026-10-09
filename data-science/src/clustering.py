"""Do patients with the same kind of course group together, without being told which kind?

Each patient becomes a vector: the change in her mean score, domain by domain, in successive 60-day blocks, relative
to her own first block (so how high she scores drops out and only the shape of her course is left). PCA reduces it
to a few components; k-means groups the patients; the groups are compared with the simulator's true trajectory
types (adjusted Rand index; 0 is chance, 1 is perfect). PCA only: UMAP would add a dependency for a picture.

Writes results/clustering_*.csv and results/figures/clustering.png.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import adjusted_rand_score

import scoring_core as sc
from common import fig_meta, get_cohort, params_from_env, save_figure, save_table

BLOCK = 60
KINDS = ["stable", "slow_decline", "fast_decline", "single_domain", "improving"]
COLOUR = dict(zip(KINDS, ["#999", "#c4572d", "#8c1c13", "#5a4e9c", "#2f6f73"]))


def trajectory_matrix(cohort) -> tuple[np.ndarray, list[str]]:
    c = cohort.contributions[cohort.contributions.completed].copy()
    c["block"] = c.day // BLOCK
    n_blocks = int(c.block.max()) + 1
    mean = c.groupby(["patient_idx", "target", "block"]).raw.mean().unstack("block").reindex(columns=range(n_blocks))
    rows = []
    for patient in range(cohort.params.n_patients):
        feats = []
        for d in sc.DOMAIN_IDS:
            series = mean.loc[(patient, d)].to_numpy() if (patient, d) in mean.index else np.full(n_blocks, np.nan)
            series = pd.Series(series).ffill().to_numpy()
            ref = series[~np.isnan(series)][0] if (~np.isnan(series)).any() else 0.0
            feats.extend(np.nan_to_num(series[1:] - ref, nan=0.0))
        rows.append(feats)
    names = [f"{d}_block{b}" for d in sc.DOMAIN_IDS for b in range(1, n_blocks)]
    return np.array(rows), names


def main() -> None:
    p = params_from_env()
    cohort = get_cohort(p)
    X, names = trajectory_matrix(cohort)
    truth = cohort.patients.sort_values("patient_idx").trajectory.to_numpy()
    pca = PCA(n_components=5, random_state=p.seed).fit(X)
    Z = pca.transform(X)

    rows = []
    for k in (2, 3, 4, 5, 6):
        labels = KMeans(n_clusters=k, n_init=20, random_state=p.seed).fit_predict(Z)
        rows.append({"k": k, "adjusted_rand_index": adjusted_rand_score(truth, labels),
                     "explained_variance_first_2_components": float(pca.explained_variance_ratio_[:2].sum())})
    scores = pd.DataFrame(rows)
    save_table(scores, "clustering_summary.csv")

    k = 5
    labels = KMeans(n_clusters=k, n_init=20, random_state=p.seed).fit_predict(Z)
    table = pd.crosstab(pd.Series(truth, name="true trajectory"), pd.Series(labels, name="cluster"))
    save_table(table.reset_index(), "clustering_crosstab.csv")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5), sharex=True, sharey=True)
    for kind in KINDS:
        sel = truth == kind
        axes[0].scatter(Z[sel, 0], Z[sel, 1], s=14, color=COLOUR[kind], label=kind.replace("_", " "), alpha=0.8)
    axes[0].set_title("Coloured by the true course")
    axes[0].legend(fontsize=8)
    axes[1].scatter(Z[:, 0], Z[:, 1], s=14, c=labels, cmap="tab10", alpha=0.8)
    axes[1].set_title(f"Coloured by k-means (k = {k}), ARI {adjusted_rand_score(truth, labels):.2f}")
    for ax in axes:
        ax.set_xlabel(f"component 1 ({pca.explained_variance_ratio_[0]:.0%})")
    axes[0].set_ylabel(f"component 2 ({pca.explained_variance_ratio_[1]:.0%})")
    save_figure(fig, "clustering.png", fig_meta(p, block_days=BLOCK))


if __name__ == "__main__":
    main()
