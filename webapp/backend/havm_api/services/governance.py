"""Governance Center.

States and transition logic are the ones implemented in src/havm/governance.py; recorded
transitions come from the EXP003 audit trail. The simulator steps the real
havm.governance.GovernanceEngine — it is not a re-implementation.

Every output here is a SIMULATED research-policy decision. Nothing triggers any action on
any model, and nothing is a patient-level or treatment recommendation.
"""
from __future__ import annotations

import copy

from havm.governance import SEVERITY, STATES, GovernanceEngine

from havm_api import artifacts as A

AUDIT = "results/audit/EXP003_audit.jsonl"
REPLAY = "results/metrics/EXP003_replay.json"
REG3 = "results/registry/EXP003_registry.json"

STATE_MEANING = {
    "NORMAL": "No monitor beyond its bound, or a held escalation.",
    "MONITOR": "Change detected without measured harm; keep watching.",
    "GOVERNANCE_REVIEW": "Corroborated input change with AHS below the review band.",
    "HUMAN_REVIEW_REQUIRED": "Measured change in model behaviour.",
    "ABSTENTION_RECOMMENDED": "Measured behaviour change and AHS below the suspension band.",
    "AUTOMATED_PREDICTION_SUSPENSION": "Collapsed policy only: AHS below the suspension band, "
                                       "with no harm assessment.",
}

# A faithful plain-language rendering of GovernanceEngine._proposed_state.
RULES = {
    "separated": [
        {"harm": "NONE", "condition": "an input monitor triggered", "proposes": "MONITOR"},
        {"harm": "NONE", "condition": "no monitor triggered", "proposes": "NORMAL"},
        {"harm": "POTENTIAL", "condition": "AHS < review band", "proposes": "GOVERNANCE_REVIEW"},
        {"harm": "POTENTIAL", "condition": "AHS ≥ review band", "proposes": "MONITOR"},
        {"harm": "MEASURED", "condition": "AHS < suspension band", "proposes": "ABSTENTION_RECOMMENDED"},
        {"harm": "MEASURED", "condition": "AHS ≥ suspension band", "proposes": "HUMAN_REVIEW_REQUIRED"},
    ],
    "collapsed": [
        {"harm": "not assessed", "condition": "AHS < suspension band", "proposes": "AUTOMATED_PREDICTION_SUSPENSION"},
        {"harm": "not assessed", "condition": "AHS < review band", "proposes": "GOVERNANCE_REVIEW"},
        {"harm": "not assessed", "condition": "otherwise", "proposes": "NORMAL"},
    ],
}


def _event(t: dict) -> str:
    if t["escalation"]:
        return "escalation"
    if t["de_escalation"]:
        return "de_escalation"
    if SEVERITY[t["proposed_state"]] > SEVERITY[t["from_state"]] and t["to_state"] == t["from_state"]:
        return "held"
    return "steady"


def overview() -> dict:
    cfg = A.monitor_config()["governance"]
    recorded_cfg = (A.optional_json(REG3) or {}).get("monitor_config", {}).get("governance")
    out = {
        "states": [{"state": s, "severity": SEVERITY[s], "meaning": STATE_MEANING.get(s, "")} for s in STATES],
        "rules": RULES,
        "config": {**cfg, "source": A.source("configs/monitors.yaml", "governance", "POLICY")},
        "config_matches_recorded_run": recorded_cfg == cfg if recorded_cfg else None,
        "persistence_note": "Escalation requires the proposed state to persist for the configured "
                            "number of consecutive windows; de-escalation is immediate.",
        "harm_levels": {
            "NONE": "Change detected, no measured effect on model behaviour.",
            "POTENTIAL": "Input change corroborated by at least two independently designed detectors.",
            "MEASURED": "An outcome-facing monitor (calibration, fairness, A2) moved past its bound; "
                        "a fairness disparity inside its permutation null band is discounted.",
        },
        "disclaimer": "Simulated research-policy outputs. The most severe state is a recommendation "
                      "recorded for a human; no model is suspended and no clinical action is taken.",
    }
    try:
        records = A.load_jsonl(AUDIT)
    except A.ArtifactMissing:
        out["timeline"] = None
        return out

    parts = {"observed": [], "injected": []}
    for i, rec in enumerate(records):
        part = "injected" if rec["window"].get("evidence_class") == "INJECTED" else "observed"
        g = rec["governance"]
        sep, col = g["separated"], g["collapsed"]
        parts[part].append({
            "audit_index": i, "window_id": rec["window_id"], "ahs": rec["ahs"],
            "severity": rec["window"].get("severity"),
            "evidence_class": rec["window"].get("evidence_class"),
            "harm": rec["harm_assessment"],
            "separated": {**{k: sep[k] for k in ("from_state", "to_state", "proposed_state", "reason")},
                          "event": _event(sep)},
            "collapsed": {**{k: col[k] for k in ("from_state", "to_state", "proposed_state", "reason")},
                          "event": _event(col)},
            "triggered_monitors": [m["monitor"] for m in rec["monitors"] if m["triggered"]],
            "ahs_components": rec["ahs_components"],
        })
    out["timeline"] = {**parts, "source": A.source(AUDIT, "governance", "SIMULATED",
                                                   "Window monitor output is OBSERVED (W) or INJECTED (R)")}

    rep = A.optional_json(REPLAY)
    if rep:
        out["comparison"] = {
            "observed": rep["part_a_observed"]["governance"],
            "injected": rep["part_b_injected"]["governance"],
            "source": A.source(REPLAY, "part_*.governance", "SIMULATED"),
        }
    return out


def simulate(steps: list[dict]) -> dict:
    """Step the real GovernanceEngine (both variants) through user-defined windows."""
    reg = copy.deepcopy(A.load_json(REG3))
    reg["monitor_config"] = copy.deepcopy(A.monitor_config())
    engines = {v: GovernanceEngine(reg, variant=v) for v in ("separated", "collapsed")}
    rows = []
    for i, s in enumerate(steps):
        harm = {"harm_level": s["harm_level"],
                "input_monitors_triggered": ["input_change"] if s["input_change"] else []}
        wid = f"S{i:02d}"
        row = {"window_id": wid, "ahs": s["ahs"], "harm_level": s["harm_level"], "input_change": s["input_change"]}
        for v, e in engines.items():
            t = e.step(wid, s["ahs"], harm if v == "separated" else None)
            row[v] = {k: t[k] for k in ("from_state", "to_state", "proposed_state", "reason")} | {"event": _event(t)}
        rows.append(row)
    return {"transitions": rows, "summaries": {v: e.summary() for v, e in engines.items()},
            "config": reg["monitor_config"]["governance"], "evidence_class": "SIMULATED",
            "method": "havm.governance.GovernanceEngine stepped with the configured bands and persistence."}
