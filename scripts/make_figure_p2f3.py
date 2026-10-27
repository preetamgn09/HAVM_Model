"""Paper 2, Figure 3 — score distributions for the paediatric and adolescent group.

    python scripts/make_figure_p2f3.py

Drawn from the per-record scores exported by EXP011, which reproduce the EXP007 group-level
AUROCs to 1e-6. No value here is reconstructed or simulated.

Two design choices are made for legibility and are stated in the caption rather than left
implicit:

  * Densities are normalised within each series. The group contains 557 records against
    55,291 in the remainder, so unnormalised counts would render the group invisible. The
    panels therefore compare distribution *shape*, not group size.
  * The Mahalanobis axis is truncated at the 99th percentile of the pooled scores. The
    distance is heavy-tailed and a small number of extreme values would otherwise compress
    the informative region. The truncated fraction is printed on the panel, and truncation
    affects display only — the reported AUROCs use all records.
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SCORES = ROOT / "results" / "scores" / "EXP011_deployment_ood_scores.csv.gz"
OUT = ROOT / "results" / "figures" / "fig07_paediatric_score_distributions.png"

INK, GROUP, REST = "#22303f", "#b4553f", "#3d6b8f"


def panel(ax, group_scores, rest_scores, title, xlabel, auroc, ci, truncate=None):
    note = ""
    if truncate is not None:
        cut = np.quantile(np.concatenate([group_scores, rest_scores]), truncate)
        n_hidden = int((group_scores > cut).sum() + (rest_scores > cut).sum())
        total = len(group_scores) + len(rest_scores)
        note = f"axis truncated at the {truncate:.0%} percentile ({n_hidden / total:.1%} of records beyond)"
        bins = np.linspace(0, cut, 60)
    else:
        lo = min(group_scores.min(), rest_scores.min())
        hi = max(group_scores.max(), rest_scores.max())
        bins = np.linspace(lo, hi, 60)

    ax.hist(rest_scores, bins=bins, density=True, alpha=0.55, color=REST,
            label=f"Remainder of evaluation domain (n = {len(rest_scores):,})")
    ax.hist(group_scores, bins=bins, density=True, alpha=0.65, color=GROUP,
            label=f"Paediatric and adolescent (n = {len(group_scores):,})")
    ax.axvline(np.median(rest_scores), color=REST, ls="--", lw=1.2)
    ax.axvline(np.median(group_scores), color=GROUP, ls="--", lw=1.2)

    ax.set_title(f"{title}\nAUROC {auroc:.3f}  (95% CI {ci[0]:.3f}–{ci[1]:.3f})",
                 fontsize=10, color=INK)
    ax.set_xlabel(xlabel, fontsize=9)
    ax.set_ylabel("Density (normalised within series)", fontsize=9)
    ax.legend(fontsize=7, frameon=False)
    if note:
        ax.text(0.98, 0.78, note, transform=ax.transAxes, ha="right", fontsize=6.5,
                color=INK, alpha=0.75)
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(labelsize=8, colors=INK)


def main() -> int:
    if not SCORES.exists():
        print(f"{SCORES} not found — run scripts/run_g9_ood_scores.py --stage export first",
              file=sys.stderr)
        return 1
    df = pd.read_csv(SCORES)
    is_group = df["group_paediatric_and_adolescent"].to_numpy().astype(bool)

    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4.2))

    panel(a,
          df.loc[is_group, "score_mahalanobis"].to_numpy(),
          df.loc[~is_group, "score_mahalanobis"].to_numpy(),
          "Mahalanobis distance (input representation)",
          "Mahalanobis distance — higher = more distant from training data",
          0.930, (0.927, 0.934), truncate=0.99)

    panel(b,
          df.loc[is_group, "score_predictive_entropy"].to_numpy(),
          df.loc[~is_group, "score_predictive_entropy"].to_numpy(),
          "Predictive entropy (frozen model confidence)",
          "Predictive entropy (nats) — higher = model less certain",
          0.235, (0.211, 0.259))

    fig.suptitle("Detector score distributions for the paediatric and adolescent group",
                 fontsize=11, color=INK)
    fig.tight_layout()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT, dpi=200)
    plt.close(fig)

    g = df.loc[is_group]
    r = df.loc[~is_group]
    print(f"wrote {OUT}")
    print("Median scores (all records, no truncation):")
    print(f"   Mahalanobis        group {g['score_mahalanobis'].median():.2f}   "
          f"remainder {r['score_mahalanobis'].median():.2f}")
    print(f"   Predictive entropy group {g['score_predictive_entropy'].median():.4f}   "
          f"remainder {r['score_predictive_entropy'].median():.4f}")
    print(f"   Model probability  group {g['model_probability'].median():.4f}   "
          f"remainder {r['model_probability'].median():.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
