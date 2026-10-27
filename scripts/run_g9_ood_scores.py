"""EXP011 — per-record OOD score export and subgroup AUROC uncertainty.

    python scripts/run_g9_ood_scores.py

This experiment adds no new method. It re-runs the EXP007 detector evaluation with an
unchanged model, unchanged training partition, unchanged evaluation domain, unchanged
preprocessing, unchanged group definitions and unchanged detector configurations, and adds
two outputs the original run did not persist:

  1. per-record detector scores for the evaluation domain, with group membership, so that
     score distributions can be plotted from measured values rather than reconstructed;
  2. stratified bootstrap confidence intervals for each subgroup AUROC.

The group-level AUROCs are recomputed and compared against the values recorded by EXP007.
The run aborts if any of them differs beyond floating-point tolerance, because a figure
drawn from scores that do not reproduce the published point estimates would not be a figure
of the published result.

Bootstrap procedure. AUROC here compares two independent samples — members of a clinically
defined group against the remainder of the evaluation domain. The resampling unit is
therefore the record, and members and non-members are resampled separately with replacement
at their observed sizes (a stratified two-sample bootstrap). This preserves the group size,
which is the quantity that governs the precision of the estimate, and it does not resample
the detector fit: the detectors are treated as fixed, so the intervals describe sampling
variability in the evaluation population, not variability in detector fitting. Intervals are
percentile intervals from 2,000 resamples.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.stats import rankdata

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from havm.datasets.d2 import build_splits
from havm.monitors.ood import TabularOOD
from havm.utils import environment_record, load_config, sha256_obj, write_json

EXPERIMENT_ID = "EXP011"
DETECTORS = ["mahalanobis", "knn", "isolation_forest", "predictive_entropy",
             "max_softmax", "energy"]
N_BOOTSTRAP = 2000
SEED = 20260819


def fast_auc(y: np.ndarray, s: np.ndarray) -> float:
    """AUROC via the Mann-Whitney identity, with midranks for ties."""
    ranks = rankdata(s)
    n_pos = int(y.sum())
    n_neg = len(y) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((ranks[y == 1].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def ood_groups(df, train_specialties):
    """Identical to EXP007. Definitions were fixed before any detector was scored."""
    return {
        "paediatric_and_adolescent": (
            df["age"].isin(["[0-10)", "[10-20)"]),
            "age bands almost absent from the training population"),
        "unseen_admission_type": (
            df["admission_type_id"].astype(str) == "7",
            "admission type genuinely unseen in training"),
        "rare_specialty": (
            ~df["medical_specialty"].isin(train_specialties),
            "specialties outside the training vocabulary"),
        "extreme_prior_utilisation": (
            df["number_inpatient"] >= 5,
            "tail of prior inpatient admissions"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/d2_diabetes.yaml")
    ap.add_argument("--registry", default="results/registry/EXP008_registry.json")
    ap.add_argument("--model", default="results/models/EXP001_frozen_model.joblib")
    ap.add_argument("--reference", default="results/metrics/EXP007-008_ood_and_full_ahs.json")
    ap.add_argument("--outdir", default="results")
    ap.add_argument("--stage", choices=["export", "bootstrap", "merge"], default="export")
    ap.add_argument("--group", default=None,
                    help="restrict the bootstrap stage to one group (keeps each run short)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    registry = json.loads(Path(args.registry).read_text())
    model = joblib.load(args.model)
    out = Path(args.outdir)

    numeric = registry["model"]["features"]["numeric"]
    categorical = registry["model"]["features"]["categorical"]
    features = numeric + categorical
    label = cfg["label"]["name"]

    splits = build_splits(cfg)
    reference, deployment = splits.train, splits.target_sealed
    train_specialties = splits.provenance["features"]["medical_specialty_vocabulary"]

    print(f"[{EXPERIMENT_ID}] fitting detectors on the training partition "
          f"(n={len(reference):,}) — configuration unchanged from EXP007")
    ood = TabularOOD(numeric, categorical).fit(reference, reference[label])
    probs = model.predict_proba(deployment[features])[:, 1]
    scores = ood.scores(deployment, probs)

    groups = ood_groups(deployment, train_specialties)
    min_group = 50

    # ---- per-record export ----------------------------------------------------------
    export = pd.DataFrame({"encounter_id": deployment["encounter_id"].to_numpy(),
                           "model_probability": probs})
    for det in DETECTORS:
        export[f"score_{det}"] = scores[det]
    evaluated = []
    for name, (mask, _) in groups.items():
        m = mask.to_numpy()
        export[f"group_{name}"] = m.astype(int)
        if m.sum() >= min_group:
            evaluated.append(name)
    export_path = out / "scores" / f"{EXPERIMENT_ID}_deployment_ood_scores.csv.gz"
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export.to_csv(export_path, index=False, compression="gzip")
    print(f"[{EXPERIMENT_ID}] per-record scores -> {export_path} "
          f"({len(export):,} records x {len(DETECTORS)} detectors)")

    # ---- reproduction check against EXP007 ------------------------------------------
    published = json.loads(Path(args.reference).read_text())["exp007_ood_bakeoff"]["groups"]
    recomputed, mismatches = {}, []
    for name in evaluated:
        y = groups[name][0].to_numpy().astype(int)
        recomputed[name] = {d: fast_auc(y, scores[d]) for d in DETECTORS}
        for d in DETECTORS:
            ref_v = published[name]["auroc"][d]
            if abs(recomputed[name][d] - ref_v) > 1e-6:
                mismatches.append({"group": name, "detector": d,
                                   "published": ref_v, "recomputed": recomputed[name][d]})
    if mismatches:
        print("REPRODUCTION FAILED — group-level AUROCs differ from EXP007:", file=sys.stderr)
        for m in mismatches:
            print(f"   {m}", file=sys.stderr)
        return 1
    print(f"[{EXPERIMENT_ID}] reproduction check passed: all "
          f"{len(evaluated) * len(DETECTORS)} group-level AUROCs match EXP007 to 1e-6")

    if args.stage == "export":
        write_json({
            "experiment_id": EXPERIMENT_ID, "stage": "export",
            "environment": environment_record(), "config_hash": sha256_obj(cfg),
            "per_record_scores": str(export_path),
            "evaluated_groups": {g: int(groups[g][0].sum()) for g in evaluated},
            "reproduction_check": {"passed": True, "tolerance": 1e-6,
                                   "n_values_checked": len(evaluated) * len(DETECTORS)},
            "group_auroc_recomputed": recomputed,
        }, out / "metrics" / f"{EXPERIMENT_ID}_export.json")
        print(f"\n[{EXPERIMENT_ID}] export stage complete. Next: --stage bootstrap --group <name>")
        return 0

    # ---- stratified two-sample bootstrap --------------------------------------------
    targets = [args.group] if args.group else evaluated
    rng = np.random.default_rng(SEED)
    for name in targets:
        y = groups[name][0].to_numpy().astype(int)
        idx_pos = np.flatnonzero(y == 1)
        idx_neg = np.flatnonzero(y == 0)
        entry = {"n_group": int(len(idx_pos)), "n_remainder": int(len(idx_neg))}
        print(f"[{EXPERIMENT_ID}] {name} (n={len(idx_pos):,} vs {len(idx_neg):,})")
        for det in DETECTORS:
            s_det = scores[det]
            draws = np.empty(N_BOOTSTRAP)
            for b in range(N_BOOTSTRAP):
                p_idx = rng.choice(idx_pos, len(idx_pos), replace=True)
                n_idx = rng.choice(idx_neg, len(idx_neg), replace=True)
                sub_s = np.concatenate([s_det[p_idx], s_det[n_idx]])
                sub_y = np.concatenate([np.ones(len(p_idx)), np.zeros(len(n_idx))])
                draws[b] = fast_auc(sub_y, sub_s)
            lo, hi = np.percentile(draws, [2.5, 97.5])
            entry[det] = {"auroc": recomputed[name][det], "ci95": [float(lo), float(hi)],
                          "excludes_chance": bool(lo > 0.5 or hi < 0.5)}
            flag = "" if entry[det]["excludes_chance"] else "   [interval includes 0.5]"
            print(f"      {det:<20} {entry[det]['auroc']:.3f}  95% CI "
                  f"[{lo:.3f}, {hi:.3f}]{flag}")
        write_json({
            "experiment_id": EXPERIMENT_ID, "stage": "bootstrap", "group": name,
            "environment": environment_record(),
            "bootstrap": {"n_resamples": N_BOOTSTRAP, "seed": SEED,
                          "resampling_unit": "record",
                          "scheme": "stratified two-sample: group members and remainder "
                                    "resampled separately with replacement at observed sizes",
                          "detector_fit": "held fixed; not resampled"},
            "interval": entry,
            "energy_note": "energy is computed on a logistic regression fitted to the same "
                           "features; the frozen gradient-boosted model produces no logit "
                           "vector. The value does not characterise the deployed model.",
        }, out / "metrics" / f"{EXPERIMENT_ID}_bootstrap_{name}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
