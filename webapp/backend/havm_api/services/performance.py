"""Model Performance workspace.

Source-domain validation metrics come from EXP001 (model selection, before the deployment
seal was opened). Deployment-domain metrics come from EXP008 and are reported separately:
the two are never averaged or mixed. No model is trained or re-scored here.
"""
from __future__ import annotations

from havm_api import artifacts as A

EXP001 = "results/metrics/EXP001_baselines.json"
CARD = "results/models/EXP001_model_card.json"
EXP008 = "results/metrics/EXP007-008_ood_and_full_ahs.json"

LABELS = {"prevalence": "Prevalence baseline", "logistic_regression": "Logistic regression",
          "gradient_boosting": "Gradient boosting"}


def _confusion(n: int, prevalence: float, op: dict) -> dict | None:
    """Recover integer confusion counts from the reported operating point.

    Only returned if the reconstruction is exactly consistent with the stored n_flagged;
    otherwise the matrix is withheld rather than approximated."""
    pos = round(n * prevalence)
    neg = n - pos
    tp = round(op["tpr"] * pos)
    fp = round(op["fpr"] * neg)
    if tp + fp != op.get("n_flagged") or abs(tp / pos - op["tpr"]) > 1e-9 or abs(fp / neg - op["fpr"]) > 1e-9:
        return None
    return {"tp": tp, "fp": fp, "fn": pos - tp, "tn": neg - fp, "positives": pos, "negatives": neg,
            "derivation": "Integer counts recovered from the stored n, prevalence, TPR, FPR and "
                          "n_flagged; returned only because all five agree exactly."}


def performance() -> dict:
    exp1 = A.load_json(EXP001)
    card = A.load_json(CARD)
    candidates = []
    for name, m in exp1["candidates"].items():
        op = m.get("operating_point", {})
        candidates.append({
            "id": name, "label": LABELS.get(name, name), "selected": name == exp1["selected_model"],
            "n": m["n"], "prevalence": m["prevalence"], "auroc": m["auroc"], "auprc": m["auprc"],
            "brier": m["brier"], "ece": m["ece"],
            "operating_point": op,
            "confusion": _confusion(m["n"], m["prevalence"], op) if op else None,
            "calibration_bins": m.get("calibration_bins", []),
            "subgroups": m.get("subgroups", {}),
        })

    deployment = None
    exp8 = A.optional_json(EXP008)
    if exp8:
        mons = {r["monitor"]: r for r in exp8["exp008_complete_ahs"]["monitors"]}
        a2, cal, a1 = mons.get("a2_relational"), mons.get("calibration"), mons.get("a1_distribution")
        deployment = {
            "domain": "emergency admissions (deployment domain, opened at Gate 5)",
            "n": sum(b["n"] for b in cal["evidence"].get("bins", [])) if cal else None,
            "auroc": a2["raw"]["auroc"] if a2 else None,
            "auroc_baseline": a2["raw"]["baseline_auroc"] if a2 else None,
            "auroc_delta": a2["raw"]["auroc_delta"] if a2 else None,
            "ece": cal["raw"]["ece"] if cal else None,
            "observed_rate": cal["raw"]["observed_rate"] if cal else None,
            "mean_predicted": cal["raw"]["mean_predicted"] if cal else None,
            "calibration_bins": cal["evidence"]["bins"] if cal else [],
            "max_psi": a1["raw"]["max_psi"] if a1 else None,
            "worst_feature": a1["raw"]["worst_feature"] if a1 else None,
            "n_features_above_psi": a1["raw"]["n_features_above_psi_threshold"] if a1 else None,
            "n_features_tested": a1["raw"]["n_features_tested"] if a1 else None,
            "ece_freeze_baseline": (A.optional_json("results/registry/EXP003_registry.json") or {})
                                   .get("freeze_baselines", {}).get("calibration", {}).get("value"),
            "evidence_class": "OBSERVED",
            "source": A.source(EXP008, "exp008_complete_ahs.monitors[a2_relational, calibration]",
                               "OBSERVED"),
            "caveat": "Measured with outcome labels for the whole deployment domain; a live "
                      "deployment would not have these labels at monitoring time.",
        }

    cfg = A.dataset_config()
    return {
        "task": {
            "name": "30-day hospital readmission",
            "label": cfg["label"],
            "dataset": cfg["dataset"]["citation"],
            "licence": cfg["dataset"]["licence"],
            "training_domain": card.get("training_domain"),
            "deployment_domain": card.get("deployment_domain"),
            "selection": card.get("selected_by"),
            "features": card.get("features"),
        },
        "model": {k: card.get(k) for k in ("model_id", "model_version", "algorithm", "frozen",
                                           "retraining_policy", "artifact_sha256", "seed")},
        "model_trained_at": card.get("environment", {}).get("timestamp_utc"),
        "candidates": candidates,
        "split": exp1["provenance"]["split"],
        "subgroup_policy": cfg["subgroups"],
        "deployment": deployment,
        "sources": {
            "validation": A.source(EXP001, "candidates", "OBSERVED",
                                   "Source-domain (non-emergency) validation set, split by patient"),
            "model_card": A.source(CARD),
        },
    }
