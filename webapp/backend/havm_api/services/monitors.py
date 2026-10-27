"""Monitor Explorer data.

Descriptive metadata (what a monitor measures, its known limitations) is documentation of
the implementation in src/havm/monitors/ and docs/monitoring.md. Every NUMBER comes from a
result file: thresholds and weights from the registry/config, measurements from EXP002,
EXP003, EXP004-006 and EXP008.

Four data situations are kept distinct and labelled:
  measured        the monitor ran on this window and produced a value
  simulated       the monitor ran on SIMULATED input (A4 telemetry)
  not_evaluated   the monitor exists but was not part of the experiment that produced the window
  unavailable     the artefact needed is missing
"""
from __future__ import annotations

from havm.triage import BEHAVIOUR_MONITORS, INPUT_MONITORS

from havm_api import artifacts as A

ORDER = ["a1_distribution", "a2_relational", "a3_structural", "a4_operational", "ood",
         "calibration", "fairness"]

# Primary metric shown on each card: (raw key, threshold key). a3 is a fraction of the schema
# contract; a4 is a fault list. Mirrors havm.sweep.METRIC_SPEC where that exists.
PRIMARY = {
    "a1_distribution": ("max_psi", "psi"),
    "a2_relational": ("score_psi", "score_psi"),
    "a3_structural": ("n_columns_affected", None),
    "a4_operational": ("faults", None),
    "ood": ("excess", "excess_rate"),
    "calibration": ("ece", "ece"),
    "fairness": ("max_delta_tpr", "delta_tpr"),
}

META = {
    "a1_distribution": {
        "name": "Distribution shift", "assumption": "A1",
        "question": "Has the input distribution moved away from the training reference?",
        "signal": "Per-feature PSI (effect size), KS / chi-squared with Benjamini–Hochberg FDR "
                  "(significance), and a linear-time MMD over the numeric block.",
        "violation_rule": "v = clip(max PSI / PSI threshold, 0, 1). Driven by effect size; "
                          "significance is carried as evidence only.",
        "needs_labels": False,
        "limitations": [
            "At deployment sample sizes nearly every feature is statistically significant; "
            "significance measures n, not drift.",
            "Saturates at 1.0 once max PSI reaches the threshold, so severity beyond the bound "
            "is not represented.",
        ],
    },
    "a2_relational": {
        "name": "Relational / performance", "assumption": "A2",
        "question": "Has the relationship between inputs and outcome changed?",
        "signal": "Predicted-score PSI (label-free) and AUROC loss against the frozen "
                  "validation value (needs labels, declared label delay).",
        "violation_rule": "v = max(score-PSI violation, AUROC-delta violation).",
        "needs_labels": "partly",
        "limitations": [
            "Score drift alone cannot separate covariate shift from concept drift.",
            "The AUROC signal needs outcome labels a live deployment would not yet have; "
            "a label-blind variant is reported separately.",
            "Not run per window in EXP003 (added at Gate 7).",
        ],
    },
    "a3_structural": {
        "name": "Structural / schema", "assumption": "A3",
        "question": "Does each window still conform to the schema contract fitted on training data?",
        "signal": "Schema violations (missing column, unseen category, out of range), "
                  "missingness drift and vocabulary growth.",
        "violation_rule": "v = fraction of contract columns affected (already on [0, 1]).",
        "needs_labels": False,
        "limitations": [
            "Recall 0 against case-mix perturbations, which is correct: the injected shift "
            "changes the population, not the schema.",
        ],
    },
    "a4_operational": {
        "name": "Operational", "assumption": "A4",
        "question": "Is the serving pipeline behaving as declared (batches, delay, latency, versions)?",
        "signal": "Missing or delayed batches, latency, schema and pipeline version changes.",
        "violation_rule": "v = 1 for a missing batch or version change; otherwise "
                          "delay / latency relative to its threshold.",
        "needs_labels": False,
        "limitations": [
            "SIMULATED. No public dataset carries pipeline telemetry; every A4 value in this "
            "project is generated and carries no evidential weight.",
            "Not run per window in EXP003 (added at Gate 7).",
        ],
    },
    "ood": {
        "name": "Out-of-distribution exposure", "assumption": "OOD",
        "question": "What share of the window lies beyond the reference score distribution?",
        "signal": "Rate of rows beyond the 99th percentile of reference OOD scores, minus "
                  "the expected 1%. Detector: Mahalanobis (chosen from the EXP007 bake-off).",
        "violation_rule": "v = clip(excess rate / excess threshold, 0, 1).",
        "needs_labels": False,
        "limitations": [
            "Detector choice is a research variable; uncertainty-based detectors performed "
            "at chance in EXP007.",
            "Not run per window in EXP003 (added at Gate 7).",
        ],
    },
    "calibration": {
        "name": "Calibration", "assumption": "Calibration",
        "question": "Do predicted probabilities still match observed readmission rates?",
        "signal": "Expected Calibration Error with equal-width bins, entering the AHS as "
                  "change from the freeze-time baseline.",
        "violation_rule": "v = clip(max(ECE − freeze ECE, 0) / ECE threshold, 0, 1) inside the AHS.",
        "needs_labels": True,
        "limitations": [
            "Requires outcome labels: a retrospective measurement, not a real-time signal.",
        ],
    },
    "fairness": {
        "name": "Fairness / subgroup", "assumption": "Fairness",
        "question": "Do true- and false-positive rates diverge across race, gender and age groups?",
        "signal": "Max ΔTPR / ΔFPR at the top-decile operating point, compared with a "
                  "200-permutation null band; groups gated on size and positive count.",
        "violation_rule": "v = max(ΔTPR, ΔFPR violations); enters the AHS as change from the "
                          "freeze-time baseline, because the frozen model already exceeds the "
                          "ΔTPR bound in-distribution (see the freeze baseline).",
        "needs_labels": True,
        "limitations": [
            "Disparities are uncorrected for case mix.",
            "A disparity inside its permutation null band is discounted by triage regardless "
            "of the declared threshold.",
        ],
    },
}

EXP008_FILE = "results/metrics/EXP007-008_ood_and_full_ahs.json"
EXP003_AUDIT = "results/audit/EXP003_audit.jsonl"
EXP003_FILE = "results/metrics/EXP003_replay.json"
EXP002_FILE = "results/metrics/EXP002_monitors.json"
BANK_FILE = "results/metrics/EXP004-006_sensitivity.json"


def family(name: str) -> str:
    if name in BEHAVIOUR_MONITORS:
        return "behaviour"
    if name in INPUT_MONITORS:
        return "input"
    return "unknown"


def primary_value(result: dict):
    key, _ = PRIMARY[result["monitor"]]
    raw = result.get("raw", {})
    if result["monitor"] == "a3_structural":
        total = raw.get("n_columns_total") or 1
        return raw.get("n_columns_affected", 0) / total
    if result["monitor"] == "a4_operational":
        return len(raw.get("faults", []))
    value = raw.get(key)
    return float(value) if isinstance(value, (int, float)) else value


def primary_threshold(result: dict):
    _, key = PRIMARY[result["monitor"]]
    if key is None:
        return None
    return result.get("threshold", {}).get(key)


def status_of(result: dict | None) -> str:
    if result is None:
        return "not_evaluated"
    if result.get("triggered"):
        return "triggered"
    return "within_bound"


def _config_view(name: str) -> dict:
    """Thresholds, weight and entry mode as currently configured (configs/monitors.yaml)."""
    cfg = A.monitor_config()
    mon = cfg["monitors"].get(name, {})
    flat = {k: v for k, v in mon.items() if not isinstance(v, (dict, list)) and k != "enabled"}
    return {
        "enabled": mon.get("enabled", False),
        "parameters": flat,
        "weight": cfg["ahs"]["weights"].get(name),
        "entry_mode": cfg["ahs"].get("entry_mode", {}).get(name, "absolute"),
        "source": A.source("configs/monitors.yaml", f"monitors.{name}", "POLICY"),
    }


def _freeze_baseline(name: str) -> dict | None:
    reg = A.optional_json("results/registry/EXP003_registry.json") or {}
    fb = reg.get("freeze_baselines", {}).get(name)
    if not fb:
        return None
    return {"metric": fb["metric_key"], "value": fb["value"],
            "source": A.source("results/registry/EXP003_registry.json",
                               f"freeze_baselines.{name}", "OBSERVED",
                               "Measured on in-distribution validation at freeze time")}


def _snapshot(name: str) -> dict:
    data = A.optional_json(EXP008_FILE)
    if not data:
        return {"availability": "unavailable", "reason": "EXP007-008 results file not found"}
    exp8 = data["exp008_complete_ahs"]
    result = next((r for r in exp8["monitors"] if r["monitor"] == name), None)
    if result is None:
        return {"availability": "not_evaluated"}
    comp = exp8.get("components", {}).get(name)
    return {
        "availability": "simulated" if result["evidence_class"] == "SIMULATED" else "measured",
        "context": f"Full deployment domain (emergency admissions, n = {_deployment_n(exp8):,}), one window",
        "status": status_of(result),
        "value": primary_value(result),
        "threshold": primary_threshold(result),
        "violation": result["violation"],
        "ahs_contribution": comp,
        "evidence_class": result["evidence_class"],
        "raw": result["raw"],
        "thresholds": result["threshold"],
        "notes": result.get("notes", []),
        "source": A.source(EXP008_FILE, f"exp008_complete_ahs.monitors[{name}]",
                           result["evidence_class"]),
    }


def _deployment_n(exp8: dict) -> int:
    a1 = next((r for r in exp8["monitors"] if r["monitor"] == "a1_distribution"), {})
    return int(a1.get("evidence", {}).get("n_window", 0))


def list_monitors() -> list[dict]:
    out = []
    for name in ORDER:
        out.append({
            "id": name, **{k: META[name][k] for k in ("name", "assumption", "question", "needs_labels")},
            "family": family(name),
            "config": _config_view(name),
            "freeze_baseline": _freeze_baseline(name),
            "snapshot": _snapshot(name),
            "per_window_available": {
                "EXP003": name in _exp003_monitor_names(),
                "EXP004-006": name in _bank_monitor_names(),
            },
        })
    return out


def _exp003_monitor_names() -> set[str]:
    try:
        recs = A.load_jsonl(EXP003_AUDIT)
    except A.ArtifactMissing:
        return set()
    return {m["monitor"] for m in recs[0]["monitors"]} if recs else set()


def _bank_monitor_names() -> set[str]:
    data = A.optional_json(BANK_FILE)
    if not data or not data.get("window_bank"):
        return set()
    return set(data["window_bank"][0]["raw"])


def monitor_detail(name: str) -> dict:
    base = next(m for m in list_monitors() if m["id"] == name)
    detail = {**base, **{k: META[name][k] for k in ("signal", "violation_rule", "limitations")}}

    # EXP003 per-window series ----------------------------------------------------------
    series = []
    try:
        records = A.load_jsonl(EXP003_AUDIT)
        replay = A.load_json(EXP003_FILE)
        entering = {}
        for part in ("part_a_observed", "part_b_injected"):
            for w in replay[part]["windows"]:
                entering[w["window_id"]] = w["violations"].get(name)
        for rec in records:
            m = next((x for x in rec["monitors"] if x["monitor"] == name), None)
            series.append({
                "window_id": rec["window_id"],
                "evidence_class": rec["window"].get("evidence_class"),
                "severity": rec["window"].get("severity"),
                "availability": "measured" if m else "not_evaluated",
                "value": primary_value(m) if m else None,
                "threshold": primary_threshold(m) if m else None,
                "violation": m["violation"] if m else None,
                "violation_entering_ahs": entering.get(rec["window_id"]) if m else None,
                "triggered": m["triggered"] if m else None,
            })
        detail["exp003_series"] = {
            "available": any(s["availability"] == "measured" for s in series),
            "reason": None if any(s["availability"] == "measured" for s in series) else
            "EXP003 ran the four Gate 4 monitors only (A1, A3, calibration, fairness). "
            "This monitor was implemented later and was not evaluated per window.",
            "windows": series,
            "source": A.source(EXP003_AUDIT, "monitors[]", None,
                               "W windows OBSERVED (random partition, no time axis); "
                               "R windows INJECTED (declared severity ramp)"),
        }
    except A.ArtifactMissing as exc:
        detail["exp003_series"] = {"available": False, "reason": f"{exc.rel} not found", "windows": []}

    # EXP002 comparisons ------------------------------------------------------------------
    exp2 = A.optional_json(EXP002_FILE)
    comps = []
    if exp2:
        for c in exp2["comparisons"]:
            r = next((x for x in c["results"] if x["monitor"] == name), None)
            comps.append({
                "comparison": c["comparison"], "n_window": c["n_window"],
                "evidence_class": {"null_control_validation": "OBSERVED",
                                   "real_deployment_domain": "OBSERVED",
                                   "injected_case_mix_shift": "INJECTED"}.get(c["comparison"]),
                "availability": "measured" if r else "not_evaluated",
                "value": primary_value(r) if r else None,
                "threshold": primary_threshold(r) if r else None,
                "violation": r["violation"] if r else None,
                "triggered": r["triggered"] if r else None,
            })
    detail["exp002_comparisons"] = {"available": bool(comps), "rows": comps,
                                    "source": A.source(EXP002_FILE, "comparisons[]")}

    # EXP004-006 window bank ---------------------------------------------------------------
    bank = A.optional_json(BANK_FILE)
    rows = []
    if bank:
        for w in bank["window_bank"]:
            rows.append({"window_id": w["window_id"], "kind": w["kind"], "severity": w["severity"],
                         "degraded": w["degraded"], "value": w["raw"].get(name)})
    detail["window_bank"] = {
        "available": bool(rows) and rows[0]["value"] is not None,
        "metric": "fraction of contract columns affected" if name == "a3_structural"
        else PRIMARY[name][0],
        "rows": rows if rows and rows[0]["value"] is not None else [],
        "reason": None if rows and rows[0]["value"] is not None else
        "The Gate 6 window bank stored raw metrics for A1, A3, calibration and fairness only.",
        "source": A.source(BANK_FILE, "window_bank[].raw", "INJECTED",
                           "Clean windows resampled from validation; perturbed windows carry a "
                           "declared severity. Ground truth is injected."),
    }

    # Monitor-specific evidence from the full deployment snapshot -------------------------
    detail["evidence"] = _evidence(name)
    return detail


def _evidence(name: str) -> dict:
    data = A.optional_json(EXP008_FILE)
    if not data:
        return {}
    result = next((r for r in data["exp008_complete_ahs"]["monitors"] if r["monitor"] == name), None)
    if not result:
        return {}
    ev = result.get("evidence", {})
    if name == "a1_distribution":
        feats = [{"feature": k, **v} for k, v in ev.get("per_feature", {}).items()]
        feats.sort(key=lambda x: x["psi"], reverse=True)
        return {"per_feature": feats, "mmd": result["raw"].get("mmd")}
    if name == "a3_structural":
        return {"schema_violations": ev.get("schema_violations", []),
                "missingness": ev.get("missingness", {}), "cardinality": ev.get("cardinality", {})}
    if name == "calibration":
        return {"bins": ev.get("bins", [])}
    if name == "fairness":
        attrs = {}
        for attr, block in ev.get("per_attribute", {}).items():
            attrs[attr] = {
                "delta_tpr": block.get("delta_tpr"), "delta_fpr": block.get("delta_fpr"),
                "groups": [{"group": g, **{k: v.get(k) for k in ("n", "n_positive", "tpr", "fpr",
                                                                 "prevalence")}}
                           for g, v in block.get("groups", {}).items()],
            }
        return {"per_attribute": attrs, "null_bands": ev.get("null_bands", {}),
                "suppressed": ev.get("suppressed", {})}
    if name == "a2_relational":
        blind = data["exp008_complete_ahs"].get("a2_label_blind")
        return {"label_blind": {"raw": blind["raw"], "violation": blind["violation"],
                                "triggered": blind["triggered"], "notes": blind.get("notes", [])}
                if blind else None}
    if name == "a4_operational":
        return {"batch": ev.get("batch"), "faults": ev.get("faults")}
    return {}
