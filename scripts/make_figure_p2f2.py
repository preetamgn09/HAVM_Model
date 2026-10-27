"""Paper 2, Figure 2 — detector-family comparison by clinical OOD proxy group.

Drawn from the group-level AUROCs already stored in EXP007-008; no new measurement.
The figure plots the mean of the distance/density family and the mean of the confidence
family within each group, against a reference line at chance.
"""
from __future__ import annotations
import json
from pathlib import Path
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "results" / "metrics" / "EXP007-008_ood_and_full_ahs.json"
OUT = ROOT / "results" / "figures" / "fig08_detector_family_by_group.png"
INK, DIST, CONF = "#22303f", "#3d6b8f", "#b4553f"
DISTANCE = ["mahalanobis", "knn", "isolation_forest"]
CONFIDENCE = ["predictive_entropy", "max_softmax", "energy"]
LABEL = {"paediatric_and_adolescent": "Paediatric and\nadolescent (n=557)",
         "rare_specialty": "Rare specialty\n(n=8,681)",
         "extreme_prior_utilisation": "Extreme prior\nutilisation (n=1,395)"}

groups = json.loads(DATA.read_text())["exp007_ood_bakeoff"]["groups"]
names = [g for g in LABEL if g in groups]
dist = [float(np.mean([groups[g]["auroc"][d] for d in DISTANCE])) for g in names]
conf = [float(np.mean([groups[g]["auroc"][d] for d in CONFIDENCE])) for g in names]

x = np.arange(len(names)); w = 0.36
fig, ax = plt.subplots(figsize=(7.2, 3.8))
b1 = ax.bar(x - w/2, dist, w, color=DIST, label="Distance / density (Mahalanobis, kNN, isolation forest)")
b2 = ax.bar(x + w/2, conf, w, color=CONF, label="Confidence (entropy, max softmax, substituted energy)")
ax.axhline(0.5, color=INK, ls="--", lw=1.1)
ax.text(len(names) - 0.45, 0.515, "chance", fontsize=7, color=INK)
for bars in (b1, b2):
    for r in bars:
        ax.text(r.get_x() + r.get_width()/2, r.get_height() + 0.012, f"{r.get_height():.3f}",
                ha="center", fontsize=7.5, color=INK)
ax.set_xticks(x); ax.set_xticklabels([LABEL[g] for g in names], fontsize=8)
ax.set_ylabel("Mean AUROC within family", fontsize=9)
ax.set_ylim(0, 1.0)
ax.set_title("Detector-family performance by clinically defined OOD proxy group",
             fontsize=10, color=INK)
ax.legend(fontsize=7.5, frameon=False, loc="upper left")
ax.spines[["top", "right"]].set_visible(False)
ax.tick_params(labelsize=8, colors=INK)
fig.tight_layout(); OUT.parent.mkdir(parents=True, exist_ok=True)
fig.savefig(OUT, dpi=200); print("wrote", OUT)
for g, d, c in zip(names, dist, conf):
    print(f"   {g:<28} distance {d:.4f}   confidence {c:.4f}")
