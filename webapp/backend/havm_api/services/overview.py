"""Command Center and experiment catalogue."""
from __future__ import annotations

from functools import lru_cache

from havm.governance import STATES
from havm.utils import sha256_file

from havm_api import artifacts as A
from havm_api.services import monitors as M
from havm_api.services.evidence import findings
from havm_api.services.replay import manager


@lru_cache(maxsize=4)
def _model_hash_check(rel: str, mtime: str | None) -> bool:
    try:
        return sha256_file(A.abs_path(rel)) == A.model_card()["artifact_sha256"]
    except (FileNotFoundError, A.ArtifactMissing):
        return False


def experiments() -> list[dict]:
    out = []
    for exp_id, meta in A.EXPERIMENTS.items():
        files = []
        generated = []
        for rel in meta["files"]:
            ok = A.exists(rel)
            ts = None
            if ok and rel.endswith(".json"):
                env = (A.load_json(rel) or {}).get("environment", {})
                ts = env.get("timestamp_utc")
                if ts:
                    generated.append(ts)
            files.append({"file": rel, "available": ok, "generated_at": ts})
        out.append({"id": exp_id, **{k: meta[k] for k in ("title", "gate", "script")},
                    "available": all(f["available"] for f in files),
                    "generated_at": max(generated) if generated else None, "files": files})
    return out


def experiment(exp_id: str) -> dict:
    meta = A.EXPERIMENTS[exp_id]
    content = {}
    for rel in meta["files"]:
        if rel.endswith(".jsonl"):
            try:
                content[rel] = {"records": len(A.load_jsonl(rel)),
                                "note": "Audit records are served by /api/audit"}
            except A.ArtifactMissing:
                content[rel] = None
        else:
            content[rel] = A.optional_json(rel)
    return {"id": exp_id, **meta, "content": content}


def overview() -> dict:
    card = A.model_card()
    dcfg = A.dataset_config()
    exp1 = A.optional_json("results/metrics/EXP001_baselines.json") or {}
    rep = A.optional_json("results/metrics/EXP003_replay.json")
    mcfg = A.monitor_config()
    caps = manager.capabilities()
    exps = experiments()

    stamps = [e["generated_at"] for e in exps if e["generated_at"]]
    out = {
        "platform": {"name": "HAVM | Clinical AI Observability",
                     "status": "Research prototype on retrospective public data. Not clinically "
                               "validated; not a medical device; no live patient data."},
        "modes": [
            {"id": "historical_replay", "label": "Historical replay", "active": True, "available": True,
             "detail": "Recorded experiment results from results/. Not real-time observations."},
            {"id": "demo_simulation", "label": "Demo simulation", "active": False,
             "available": caps["can_start"], "detail": caps["reason"] or
             "Replays the project pipeline on the retrospective dataset from the Replay Lab."},
            {"id": "live_integration", "label": "Live integration", "active": False, "available": False,
             "detail": caps["live_integration"]["reason"]},
        ],
        "results_generated": {"earliest": min(stamps) if stamps else None,
                              "latest": max(stamps) if stamps else None,
                              "note": "Timestamps recorded by the research scripts when each experiment ran."},
        "model": {
            **{k: card.get(k) for k in ("model_id", "model_version", "algorithm", "frozen",
                                        "selected_by", "retraining_policy", "artifact_sha256")},
            "frozen_at": card.get("environment", {}).get("timestamp_utc"),
            "artifact_hash_verified": _model_hash_check(card["artifact"], A.mtime_iso(card["artifact"])),
            "validation_metrics": {k: v for k, v in card.get("validation_metrics", {}).items()
                                   if k != "operating_point"},
            "source": A.source("results/models/EXP001_model_card.json"),
        },
        "dataset": {
            "citation": dcfg["dataset"]["citation"], "licence": dcfg["dataset"]["licence"],
            "version": dcfg["dataset"]["version"], "sha256": dcfg["dataset"]["expected_sha256"],
            "provenance_status_config": dcfg["dataset"].get("provenance_status"),
            "provenance_status_at_exp001": exp1.get("provenance", {}).get("raw", {}).get("provenance_status"),
            "provenance_note": "EXP001 ran on a mirror copy (recorded MIRROR_UNVERIFIED). The canonical "
                               "UCI file was later downloaded and hashes to the same SHA-256, so the "
                               "configuration now records UCI_VERIFIED (research/final_report.md §3).",
            "cohort": exp1.get("provenance", {}).get("cohort"),
            "domain": exp1.get("provenance", {}).get("domain"),
            "split": exp1.get("provenance", {}).get("split"),
            "sealed_deployment_set": exp1.get("sealed_deployment_set"),
            "historical": True, "time_axis": False,
            "source": A.source("results/metrics/EXP001_baselines.json", "provenance"),
        },
        "ahs": None, "signals": [], "governance": None, "recent_events": [],
        "findings": findings(),
        "experiments": exps,
        "bands": {**mcfg["governance"]["bands"], "source": A.source("configs/monitors.yaml", "governance.bands", "POLICY")},
        "ahs_explanation": "AHS = 1 − Σ wₖ·vₖ. 1.0 means no monitored assumption is violated; lower "
                           "values mean larger weighted violations. Below the review band the policy "
                           "considers review; below the suspension band, stronger recommendations. "
                           "The formula and bands are POLICY choices of this project, not validated values.",
    }

    exp8 = A.optional_json("results/metrics/EXP007-008_ood_and_full_ahs.json")
    if rep:
        a = rep["part_a_observed"]
        out["ahs"] = {
            "observed_windows": [{"window_id": w["window_id"], "ahs": w["ahs"], "harm_level": w["harm_level"],
                                  "states": w["states"]} for w in a["windows"]],
            "observed_mean": a["ahs_mean"], "observed_sd": a["ahs_sd"], "observed_range": a["ahs_range"],
            "observed_monitor_count": len(a["windows"][0]["weights"]) if a["windows"] else 0,
            "seven_monitor_full_domain": exp8["exp008_complete_ahs"]["ahs_seven_monitors"] if exp8 else None,
            "n_windows_evaluated": len(a["windows"]) + len(rep["part_b_injected"]["windows"]),
            "n_observed": len(a["windows"]), "n_injected": len(rep["part_b_injected"]["windows"]),
            "latest_run_at": rep["environment"]["timestamp_utc"],
            "source": A.source("results/metrics/EXP003_replay.json", "part_a_observed", "OBSERVED"),
        }
        out["governance"] = {
            "states": STATES,
            "observed": {v: s["state_occupancy"] for v, s in a["governance"].items()},
            "injected": {v: s["state_occupancy"] for v, s in rep["part_b_injected"]["governance"].items()},
            "source": A.source("results/metrics/EXP003_replay.json", "part_*.governance", "SIMULATED"),
        }
    for m in M.list_monitors():
        snap = m["snapshot"]
        out["signals"].append({"id": m["id"], "name": m["name"], "assumption": m["assumption"],
                               "family": m["family"], "status": snap.get("status", snap.get("availability")),
                               "availability": snap.get("availability"),
                               "violation": snap.get("violation"), "evidence_class": snap.get("evidence_class"),
                               "value": snap.get("value"), "threshold": snap.get("threshold")})
    try:
        from havm_api.services.audit import row
        recs = A.load_jsonl("results/audit/EXP003_audit.jsonl")
        rows = [row(i, r, "EXP003") for i, r in enumerate(recs)]
        notable = [r for r in rows if r["event"] in ("escalation", "de_escalation", "held")]
        out["recent_events"] = notable[-8:][::-1]
    except A.ArtifactMissing:
        pass
    return out
