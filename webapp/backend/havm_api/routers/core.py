"""Health, overview, models, experiments and figures."""
from __future__ import annotations

import re

from fastapi import APIRouter, Path as P
from fastapi.responses import FileResponse

from havm_api import __version__
from havm_api import artifacts as A
from havm_api.config import get_settings
from havm_api.errors import ApiError
from havm_api.schemas import Envelope, ErrorResponse, Health
from havm_api.services import overview as O
from havm_api.services.replay import manager

router = APIRouter(prefix="/api", tags=["platform"])
FIG_RE = re.compile(r"^fig\d{2}_[a-z0-9_]+\.png$")
ERR = {404: {"model": ErrorResponse}}


@router.get("/health", response_model=Health)
def health():
    """Liveness plus a check that the core research artefacts are readable."""
    files = {
        "model_card": "results/models/EXP001_model_card.json",
        "frozen_model": "results/models/EXP001_frozen_model.joblib",
        "exp003_replay": "results/metrics/EXP003_replay.json",
        "exp003_audit": "results/audit/EXP003_audit.jsonl",
        "sensitivity": "results/metrics/EXP004-006_sensitivity.json",
        "monitors_config": "configs/monitors.yaml",
    }
    present = {k: A.exists(v) for k, v in files.items()}
    caps = manager.capabilities()
    return Health(
        status="ok" if all(present.values()) else "degraded", version=__version__, artefacts=present,
        replay={"can_start": caps["can_start"], "busy": caps["busy"],
                "dataset_present": caps["dataset"]["present"]},
        frontend_built=(get_settings().frontend_dist / "index.html").is_file(),
    )


@router.get("/overview", response_model=Envelope)
def overview():
    """Command Center: modes, model, dataset provenance, AHS, signals, governance, findings."""
    return Envelope(data=O.overview(), meta={"historical": True})


@router.get("/models", response_model=Envelope)
def models():
    """The monitored (frozen) model and the candidates it was selected from."""
    card = A.model_card()
    exp1 = A.load_json("results/metrics/EXP001_baselines.json")
    cands = [{"id": k, "auroc": v["auroc"], "auprc": v["auprc"], "brier": v["brier"], "ece": v["ece"],
              "selected": k == exp1["selected_model"]} for k, v in exp1["candidates"].items()]
    safe_card = {k: v for k, v in card.items() if k != "environment"}
    safe_card["recorded_environment"] = {k: card.get("environment", {}).get(k) for k in ("timestamp_utc", "python", "packages")}
    return Envelope(data={"monitored_model": safe_card, "candidates": cands},
                    meta={"source": A.source("results/models/EXP001_model_card.json")})


@router.get("/experiments", response_model=Envelope)
def experiments():
    """Catalogue of experiments with their result files and generation timestamps."""
    return Envelope(data=O.experiments())


@router.get("/experiments/{experiment_id}", response_model=Envelope, responses=ERR)
def experiment(experiment_id: str = P(..., pattern=r"^EXP\d{3}(-\d{3})?$")):
    """Raw recorded content of one experiment's result files (bounded: largest file is ~62 KB)."""
    if experiment_id not in A.EXPERIMENTS:
        raise ApiError(404, "experiment_not_found", f"No experiment {experiment_id}.")
    return Envelope(data=O.experiment(experiment_id), meta={"read_only": True})


@router.get("/figures", response_model=Envelope)
def figures():
    """Static research figures produced by scripts/make_figures*.py."""
    root = A.abs_path("results/figures")
    names = sorted(p.name for p in root.glob("*.png") if FIG_RE.match(p.name)) if root.is_dir() else []
    return Envelope(data=[{"name": n, "url": f"/api/figures/{n}"} for n in names])


@router.get("/figures/{name}", responses=ERR)
def figure(name: str):
    if not FIG_RE.match(name):
        raise ApiError(404, "figure_not_found", "Unknown figure.")
    path = A.abs_path(f"results/figures/{name}")
    if not path.is_file():
        raise ApiError(404, "figure_not_found", "Unknown figure.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})
