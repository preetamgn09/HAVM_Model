"""Runtime configuration for the HAVM web application.

Everything is read from environment variables so that the same build runs locally and on
Render. Research artefacts under results/ are treated as READ-ONLY: nothing in the web
application writes there. Runs started from the web UI are written to HAVM_RUNS_DIR.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except ValueError:
        value = default
    return max(lo, min(hi, value))


@dataclass(frozen=True)
class Settings:
    repo_root: Path
    results_dir: Path
    configs_dir: Path
    runs_dir: Path
    frontend_dist: Path
    allow_dataset_fetch: bool
    dataset_source: str
    replay_enabled: bool
    replay_timeout_seconds: int
    max_stored_runs: int
    cors_origins: tuple[str, ...]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    default_root = Path(__file__).resolve().parents[3]
    repo_root = Path(os.environ.get("HAVM_REPO_ROOT", default_root)).resolve()
    webapp = repo_root / "webapp"
    runs_dir = Path(os.environ.get("HAVM_RUNS_DIR", webapp / "runtime" / "runs")).resolve()
    dist = Path(os.environ.get("HAVM_FRONTEND_DIST", webapp / "frontend" / "dist")).resolve()
    origins = tuple(o.strip() for o in os.environ.get("HAVM_CORS_ORIGINS", "").split(",") if o.strip())
    source = os.environ.get("HAVM_DATASET_SOURCE", "mirror").strip().lower()
    return Settings(
        repo_root=repo_root,
        results_dir=repo_root / "results",
        configs_dir=repo_root / "configs",
        runs_dir=runs_dir,
        frontend_dist=dist,
        allow_dataset_fetch=_bool("HAVM_ALLOW_DATASET_FETCH", False),
        dataset_source=source if source in {"uci", "mirror"} else "mirror",
        replay_enabled=_bool("HAVM_REPLAY_ENABLED", True),
        replay_timeout_seconds=_int("HAVM_REPLAY_TIMEOUT_SECONDS", 600, 30, 3600),
        max_stored_runs=_int("HAVM_MAX_STORED_RUNS", 20, 1, 200),
        cors_origins=origins,
    )


def ensure_research_package_importable() -> None:
    """Make the existing research package (src/havm) importable without installing it,
    exactly as the project's own scripts do."""
    src = str(get_settings().repo_root / "src")
    if src not in sys.path:
        sys.path.insert(0, src)


ensure_research_package_importable()
