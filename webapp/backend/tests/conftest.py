import hashlib
import logging
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "webapp" / "backend"))
os.environ.setdefault("HAVM_RUNS_DIR", tempfile.mkdtemp(prefix="havm_test_runs_"))
os.environ.setdefault("HAVM_ALLOW_DATASET_FETCH", "false")
logging.disable(logging.INFO)

from fastapi.testclient import TestClient  # noqa: E402

from havm_api.main import app  # noqa: E402

DATASET = ROOT / "data" / "raw" / "diabetic_data.csv"


def _digest(folder: Path) -> dict:
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session", autouse=True)
def research_artefacts_untouched():
    """The web application must never modify results/ or configs/."""
    before = {d: _digest(ROOT / d) for d in ("results", "configs")}
    yield
    after = {d: _digest(ROOT / d) for d in ("results", "configs")}
    assert before == after, "results/ or configs/ changed during the API test session"


needs_dataset = pytest.mark.skipif(not DATASET.is_file(), reason="D2 dataset not present (run scripts/fetch_d2.py)")
