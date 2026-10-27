"""Read-only access to the research artefacts in results/ and configs/.

Every value the dashboard shows is read from these files (or recomputed from them with the
project's own code). Nothing is hardcoded. Files are cached by (mtime, size) so a re-run of
the research scripts is picked up without restarting the server.

Paths returned to clients are always repository-relative (e.g. "results/metrics/..."), never
absolute, so the deployment's filesystem layout is not exposed.
"""
from __future__ import annotations

import gzip
import json
import threading
from pathlib import Path
from typing import Any

import yaml

from havm_api.config import get_settings

_lock = threading.Lock()
_cache: dict[str, tuple[tuple[float, int], Any]] = {}


class ArtifactMissing(Exception):
    def __init__(self, rel: str):
        super().__init__(rel)
        self.rel = rel


# Experiment catalogue. Titles and gates come from README.md's status table; the files are
# the outputs named in scripts/reproduce_all.py.
EXPERIMENTS: dict[str, dict] = {
    "EXP001": {"title": "Data pipeline, baselines and model freeze", "gate": "G3",
               "script": "scripts/run_g3.py", "files": ["results/metrics/EXP001_baselines.json"]},
    "EXP002": {"title": "Monitors A1, A3, calibration and fairness", "gate": "G4",
               "script": "scripts/run_g4.py", "files": ["results/metrics/EXP002_monitors.json"]},
    "EXP003": {"title": "AHS, triage, governance, audit and end-to-end replay", "gate": "G5",
               "script": "scripts/run_g5.py", "files": ["results/metrics/EXP003_replay.json",
                                                        "results/audit/EXP003_audit.jsonl"]},
    "EXP004-006": {"title": "Thresholds, weights, normalisation, baseline ladder and ablation",
                   "gate": "G6", "script": "scripts/run_g6.py",
                   "files": ["results/metrics/EXP004-006_sensitivity.json"]},
    "EXP007-008": {"title": "OOD bake-off and the complete seven-monitor AHS", "gate": "G7",
                   "script": "scripts/run_g7.py",
                   "files": ["results/metrics/EXP007-008_ood_and_full_ahs.json"]},
    "EXP009-010": {"title": "Scalability and AHS stability", "gate": "G8",
                   "script": "scripts/run_g8.py",
                   "files": ["results/metrics/EXP009-010_scalability_stability.json"]},
    "EXP011": {"title": "Per-record OOD scores and subgroup bootstrap intervals", "gate": "G9",
               "script": "scripts/run_g9_ood_scores.py",
               "files": ["results/metrics/EXP011_export.json",
                         "results/metrics/EXP011_bootstrap_paediatric_and_adolescent.json",
                         "results/metrics/EXP011_bootstrap_rare_specialty.json",
                         "results/metrics/EXP011_bootstrap_extreme_prior_utilisation.json"]},
}

REGISTRY_SNAPSHOTS = ["EXP001", "EXP002", "EXP003", "EXP008"]


def _abs(rel: str) -> Path:
    root = get_settings().repo_root
    path = (root / rel).resolve()
    if root not in path.parents and path != root:
        raise ArtifactMissing(rel)  # refuse anything escaping the repository
    return path


def exists(rel: str) -> bool:
    try:
        return _abs(rel).is_file()
    except ArtifactMissing:
        return False


def _cached(rel: str, loader):
    path = _abs(rel)
    try:
        st = path.stat()
    except FileNotFoundError:
        raise ArtifactMissing(rel) from None
    key = (st.st_mtime, st.st_size)
    with _lock:
        hit = _cache.get(rel)
        if hit and hit[0] == key:
            return hit[1]
    value = loader(path)
    with _lock:
        _cache[rel] = (key, value)
    return value


def load_json(rel: str) -> Any:
    return _cached(rel, lambda p: json.loads(p.read_text()))


def load_jsonl(rel: str) -> list[dict]:
    def _read(p: Path):
        with open(p) as fh:
            return [json.loads(line) for line in fh if line.strip()]
    return _cached(rel, _read)


def load_yaml(rel: str) -> Any:
    return _cached(rel, lambda p: yaml.safe_load(p.read_text()))


def load_csv_gz_columns(rel: str) -> Any:
    import pandas as pd

    def _read(p: Path):
        with gzip.open(p, "rt") as fh:
            return pd.read_csv(fh)
    return _cached(rel, _read)


def optional_json(rel: str) -> Any | None:
    try:
        return load_json(rel)
    except ArtifactMissing:
        return None


def mtime_iso(rel: str) -> str | None:
    from datetime import datetime, timezone
    try:
        return datetime.fromtimestamp(_abs(rel).stat().st_mtime, tz=timezone.utc).isoformat()
    except (FileNotFoundError, ArtifactMissing):
        return None


def abs_path(rel: str) -> Path:
    """Server-side only. Never return this value to a client."""
    return _abs(rel)


# Convenience accessors ------------------------------------------------------------------
def model_card() -> dict:
    return load_json("results/models/EXP001_model_card.json")


def monitor_config() -> dict:
    return load_yaml("configs/monitors.yaml")


def dataset_config() -> dict:
    return load_yaml("configs/d2_diabetes.yaml")


def registry_snapshot(exp: str) -> dict:
    return load_json(f"results/registry/{exp}_registry.json")


def exp(name: str) -> dict:
    files = {
        "EXP001": "results/metrics/EXP001_baselines.json",
        "EXP002": "results/metrics/EXP002_monitors.json",
        "EXP003": "results/metrics/EXP003_replay.json",
        "EXP004-006": "results/metrics/EXP004-006_sensitivity.json",
        "EXP007-008": "results/metrics/EXP007-008_ood_and_full_ahs.json",
        "EXP009-010": "results/metrics/EXP009-010_scalability_stability.json",
    }
    return load_json(files[name])


def source(rel: str, field: str | None = None, evidence: str | None = None, note: str | None = None) -> dict:
    """A provenance pointer attached to every value the UI displays."""
    out = {"file": rel}
    if field:
        out["field"] = field
    if evidence:
        out["evidence_class"] = evidence
    if note:
        out["note"] = note
    return out
