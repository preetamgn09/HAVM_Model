"""Dataset availability for replay.

The dataset is never committed to Git and never sent anywhere. Replays need the raw D2 file
on the server; it is acquired only on explicit request (never at startup), and only when
HAVM_ALLOW_DATASET_FETCH is enabled. Acquisition reuses scripts/fetch_d2.py's source URLs and
the checksum declared in configs/d2_diabetes.yaml: a file that does not hash to the declared
value is deleted and never used.
"""
from __future__ import annotations

import importlib.util
import logging
import threading
import urllib.request
import zipfile
from pathlib import Path

from havm.utils import sha256_file

from havm_api import artifacts as A
from havm_api.config import get_settings

log = logging.getLogger("havm_api.dataset")
_lock = threading.Lock()
_verified: dict[str, tuple[float, int]] = {}


def _fetch_module():
    path = get_settings().repo_root / "scripts" / "fetch_d2.py"
    spec = importlib.util.spec_from_file_location("havm_fetch_d2", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def raw_path() -> Path:
    return get_settings().repo_root / A.dataset_config()["dataset"]["raw_file"]


def status() -> dict:
    s = get_settings()
    path = raw_path()
    present = path.is_file()
    key = None
    if present:
        st = path.stat()
        key = (st.st_mtime, st.st_size)
    return {
        "present": present,
        "verified": present and _verified.get(str(path)) == key,
        "fetch_allowed": s.allow_dataset_fetch,
        "fetch_source": s.dataset_source,
        "expected_sha256": A.dataset_config()["dataset"]["expected_sha256"],
        "licence": A.dataset_config()["dataset"]["licence"],
    }


def ensure(progress=lambda msg: None) -> None:
    """Make sure a checksum-verified dataset is present. Raises RuntimeError with a
    user-facing message if that is not possible."""
    with _lock:
        cfg = A.dataset_config()["dataset"]
        path = raw_path()
        if not path.is_file():
            if not get_settings().allow_dataset_fetch:
                raise RuntimeError(
                    "The D2 dataset is not on this server and automatic download is disabled. "
                    "Run `python scripts/fetch_d2.py` in the repository, or set "
                    "HAVM_ALLOW_DATASET_FETCH=true.")
            _download(path, progress)
        st = path.stat()
        if _verified.get(str(path)) == (st.st_mtime, st.st_size):
            return
        progress("Verifying dataset checksum")
        actual = sha256_file(path)
        if actual != cfg["expected_sha256"]:
            raise RuntimeError("The dataset on this server does not match the checksum declared in "
                               "configs/d2_diabetes.yaml. Replay refused.")
        _verified[str(path)] = (st.st_mtime, st.st_size)


def _download(dest: Path, progress) -> None:
    mod = _fetch_module()
    source = get_settings().dataset_source
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".partial")
    try:
        if source == "uci":
            progress("Downloading D2 from the UCI repository")
            zpath = dest.parent / "uci_296.partial.zip"
            urllib.request.urlretrieve(mod.UCI_ZIP, zpath)
            with zipfile.ZipFile(zpath) as zf:
                name = next(n for n in zf.namelist() if n.endswith("diabetic_data.csv"))
                tmp.write_bytes(zf.read(name))
            zpath.unlink(missing_ok=True)
        else:
            progress("Downloading D2 from the checksum-verified mirror")
            urllib.request.urlretrieve(mod.MIRROR_CSV, tmp)
        actual = sha256_file(tmp)
        if actual != A.dataset_config()["dataset"]["expected_sha256"]:
            raise RuntimeError("Downloaded file failed checksum verification and was discarded.")
        tmp.replace(dest)
        log.info("dataset acquired and verified")
    except RuntimeError:
        raise
    except Exception as exc:  # network errors etc.
        log.warning("dataset download failed: %s", type(exc).__name__)
        raise RuntimeError("The dataset could not be downloaded from the configured source.") from None
    finally:
        tmp.unlink(missing_ok=True)
