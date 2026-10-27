"""Assumption Registry viewer (read-only).

Saved snapshots in results/registry/ are historical records and are never modified. The
currently loaded configuration (configs/*.yaml) is shown separately. Integrity is checked by
recomputing each snapshot's hash with havm.utils.sha256_obj, the function that produced it.
"""
from __future__ import annotations

from havm.utils import sha256_obj

from havm_api import artifacts as A


# Fields written by havm.registry.build_registry at Gate 3, which registry_hash covers.
G3_CORE = ["registry_version", "gate", "owner", "effective_date", "model", "dataset",
           "label_definition", "feature_expectations", "subgroups", "monitored_assumptions",
           "thresholds", "ahs_weights", "governance_policy", "validation_history"]


def _integrity(reg: dict) -> dict:
    """Verify the stored hash with havm.utils.sha256_obj, the function that produced it.

    registry_hash is computed once, at Gate 3, over the build_registry fields. Later gates
    add sections, bump the version and append validation events without recomputing it, so
    the meaningful check is: does the stored hash still verify the Gate 3 core as built?"""
    stored = reg.get("registry_hash")
    whole = sha256_obj({k: v for k, v in reg.items() if k != "registry_hash"})
    core = {k: reg.get(k) for k in G3_CORE}
    core_as_built = dict(core, registry_version="0.1.0", validation_history=[])
    core_ok = sha256_obj(core_as_built) == stored
    added = sorted(k for k in reg if k not in G3_CORE and k != "registry_hash")
    return {
        "stored_hash": stored,
        "recomputed_full_content_hash": whole,
        "stored_matches_full_content": whole == stored,
        "g3_core_verified": core_ok,
        "sections_added_after_g3": added,
        "note": ("Stored hash verifies the Gate 3 core content unchanged. Later sections ("
                 + ", ".join(added) + ") and the version / validation-history updates are not covered "
                 "by any hash in the saved artefact.") if core_ok and added else
                ("Stored hash verifies the full content.") if whole == stored else
                "Stored hash does not verify this snapshot's Gate 3 core content.",
    }


def snapshots() -> list[dict]:
    out = []
    for exp in A.REGISTRY_SNAPSHOTS:
        rel = f"results/registry/{exp}_registry.json"
        reg = A.optional_json(rel)
        if reg is None:
            out.append({"id": exp, "available": False})
            continue
        out.append({
            "id": exp, "available": True, "file": rel,
            "registry_version": reg.get("registry_version"), "gate": reg.get("gate"),
            "effective_date": reg.get("effective_date"),
            "sections": sorted(reg.keys()),
            "validation_events": len(reg.get("validation_history", [])),
            "integrity": _integrity(reg),
        })
    return out


def snapshot(exp: str) -> dict:
    rel = f"results/registry/{exp}_registry.json"
    reg = A.load_json(rel)
    model = dict(reg.get("model", {}))
    return {
        "id": exp, "file": rel, "read_only": True,
        "registry_version": reg.get("registry_version"), "gate": reg.get("gate"),
        "owner": reg.get("owner"), "effective_date": reg.get("effective_date"),
        "integrity": _integrity(reg),
        "model": model,
        "dataset": reg.get("dataset"),
        "label_definition": reg.get("label_definition"),
        "feature_expectations": reg.get("feature_expectations"),
        "subgroups": reg.get("subgroups"),
        "monitored_assumptions": reg.get("monitored_assumptions"),
        "monitored_assumptions_note": "Status fields as recorded at Gate 3. The registry builder did "
                                      "not update them when later gates implemented the monitors; "
                                      "see monitor_config for what each run actually used.",
        "thresholds": reg.get("thresholds"),
        "ahs_weights": reg.get("ahs_weights"),
        "governance_policy": reg.get("governance_policy"),
        "monitor_config": reg.get("monitor_config"),
        "freeze_baselines": reg.get("freeze_baselines"),
        "sealed_deployment_set": reg.get("sealed_deployment_set"),
        "validation_history": reg.get("validation_history", []),
    }


def current() -> dict:
    mc = A.monitor_config()
    dc = A.dataset_config()
    return {
        "monitors_yaml": mc, "dataset_yaml": dc,
        "monitor_config_hash": sha256_obj(mc), "dataset_config_hash": sha256_obj(dc),
        "files": ["configs/monitors.yaml", "configs/d2_diabetes.yaml"],
        "weights_sum": sum(mc["ahs"]["weights"].values()),
        "note": "This is the configuration the code would load now. Historical runs used the "
                "configuration embedded in their registry snapshot and identified by its hash.",
    }


def _flatten(obj, prefix="", out=None, depth=0):
    out = {} if out is None else out
    if isinstance(obj, dict) and depth < 6:
        for k, v in obj.items():
            _flatten(v, f"{prefix}.{k}" if prefix else str(k), out, depth + 1)
    else:
        out[prefix] = obj
    return out


def diff(a: str, b: str, limit: int = 400) -> dict:
    ra = A.load_json(f"results/registry/{a}_registry.json")
    rb = A.load_json(f"results/registry/{b}_registry.json")
    fa, fb = _flatten(ra), _flatten(rb)
    changes = []
    for key in sorted(set(fa) | set(fb)):
        if key.startswith("feature_expectations.columns"):
            continue  # schema contract is identical across snapshots and very large
        va, vb = fa.get(key, "<absent>"), fb.get(key, "<absent>")
        if va != vb:
            kind = "added" if va == "<absent>" else "removed" if vb == "<absent>" else "changed"
            changes.append({"path": key, "kind": kind, "from": va, "to": vb})
    return {"from": a, "to": b, "n_changes": len(changes), "changes": changes[:limit],
            "truncated": len(changes) > limit}
