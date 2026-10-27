"""Replay & demo runs.

Two sources of runs:

  EXP003           the recorded historical replay (results/metrics/EXP003_replay.json and
                   results/audit/EXP003_audit.jsonl). Read-only, always available.
  run-<timestamp>  a replay started from the web UI. It drives the project's own pipeline:
                   havm.datasets.d2.build_splits, havm.replay windows, the monitors,
                   havm.aggregation.compute_ahs, havm.triage, havm.governance.GovernanceEngine
                   and havm.governance.AuditTrail. The four-monitor set, freeze baselines and
                   the injected perturbation are imported from scripts/run_g5.py itself.

With the default settings a web run reproduces the recorded EXP003 AHS values; the
comparison is computed and reported, not assumed.

Only one run executes at a time (an expensive run cannot be launched twice), each run has a
deadline checked between windows, and runs are written to HAVM_RUNS_DIR, never to results/.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import logging
import math
import re
import secrets
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from havm_api import artifacts as A
from havm_api.config import get_settings
from havm_api.services import dataset

log = logging.getLogger("havm_api.replay")

RUN_ID_RE = re.compile(r"^(EXP003|run-\d{8}-\d{6}-[0-9a-f]{6})$")
WINDOW_ID_RE = re.compile(r"^[A-Z]\d{2,3}$")
TERMINAL = {"completed", "failed", "timed_out", "interrupted"}
RAMP = [0.0, 0.0, 0.25, 0.50, 0.75, 1.00, 0.75, 0.25, 0.0, 0.0]  # as declared in run_g5.py
FOUR = ["a1_distribution", "a3_structural", "calibration", "fairness"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean(obj):
    """JSON-safe copy: numpy scalars to Python, NaN/inf to None, tuples to lists."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes)):
        try:
            obj = obj.item()
        except (ValueError, AttributeError):
            return str(obj)
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    return str(obj)


def _load_script(name: str):
    path = get_settings().repo_root / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"havm_script_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------------------- window shaping
def _summary(detail: dict) -> dict:
    keys = ("window_id", "index", "evidence_class", "n", "severity", "ahs", "ahs_declared_weights",
            "harm_level", "states", "triggered", "alert_ahs", "alert_or_rule", "saturated",
            "missing_monitors", "events")
    return {k: detail.get(k) for k in keys}


def _event(t: dict) -> str:
    from havm.governance import SEVERITY
    if t.get("escalation"):
        return "escalation"
    if t.get("de_escalation"):
        return "de_escalation"
    if SEVERITY[t["proposed_state"]] > SEVERITY[t["from_state"]] and t["to_state"] == t["from_state"]:
        return "held"
    return "steady"


def _detail_from_parts(*, window_id, index, meta, results, ahs_result, harm, decisions, packet,
                       review_band, monitor_evidence: bool) -> dict:
    triggered = [r["monitor"] for r in results if r["triggered"]]
    comps = ahs_result["components"]
    return clean({
        "window_id": window_id, "index": index,
        "evidence_class": meta.get("evidence_class"), "n": meta.get("n"),
        "severity": meta.get("severity"), "meta": meta,
        "ahs": ahs_result["ahs"], "ahs_declared_weights": ahs_result.get("ahs_declared_weights"),
        "ahs_renormalised": ahs_result.get("ahs_renormalised"),
        "missing_monitors": ahs_result.get("missing_monitors", []),
        "saturated": ahs_result.get("saturated_components", []),
        "ahs_notes": ahs_result.get("notes", []),
        "components": {k: {"violation_entering_ahs": c.get("violation_entering_ahs"),
                           "weight": c.get("weight_renormalised"),
                           "contribution": c.get("contribution_renormalised"),
                           "saturated": c.get("saturated"), "derivation": c.get("derivation")}
                       for k, c in comps.items()},
        "monitors": [{k: r.get(k) for k in ("monitor", "assumption", "evidence_class", "raw", "threshold",
                                            "violation", "triggered", "notes")}
                     | ({"evidence": r.get("evidence")} if monitor_evidence else {})
                     for r in results],
        "triggered": triggered,
        "harm": harm, "harm_level": harm["harm_level"],
        "governance": {v: d for v, d in decisions.items()},
        "states": {v: d["to_state"] for v, d in decisions.items()},
        "events": {v: _event(d) for v, d in decisions.items()},
        "alert_packet": packet,
        "alert_ahs": ahs_result["ahs"] < review_band,
        "alert_or_rule": bool(triggered),
        "review_band": review_band,
    })


# --------------------------------------------------------------------------- historical run
def _historical() -> dict | None:
    try:
        rep = A.load_json("results/metrics/EXP003_replay.json")
        audit = A.load_jsonl("results/audit/EXP003_audit.jsonl")
    except A.ArtifactMissing:
        return None
    band = A.load_json("results/registry/EXP003_registry.json")["monitor_config"]["governance"]["bands"]["review"]
    logs = {w["window_id"]: w for part in ("part_a_observed", "part_b_injected") for w in rep[part]["windows"]}
    windows = []
    for i, rec in enumerate(audit):
        lw = logs.get(rec["window_id"], {})
        comps = {k: {"violation_entering_ahs": lw.get("violations", {}).get(k),
                     "weight_renormalised": lw.get("weights", {}).get(k),
                     "contribution_renormalised": v, "saturated": k in lw.get("saturated", []),
                     "derivation": None}
                 for k, v in rec["ahs_components"].items()}
        ahs_result = {"ahs": rec["ahs"], "ahs_declared_weights": lw.get("ahs_declared_weights"),
                      "ahs_renormalised": lw.get("ahs_renormalised"),
                      "missing_monitors": lw.get("missing_monitors", []),
                      "saturated_components": lw.get("saturated", []),
                      "notes": rec["alert_packet"].get("caveats", [])[:3], "components": comps}
        d = _detail_from_parts(window_id=rec["window_id"], index=i, meta=rec["window"],
                               results=rec["monitors"], ahs_result=ahs_result,
                               harm=rec["harm_assessment"], decisions=rec["governance"],
                               packet=rec["alert_packet"], review_band=band, monitor_evidence=False)
        d["part"] = "injected" if rec["window"].get("evidence_class") == "INJECTED" else "observed"
        d["recorded_at"] = rec["timestamp"]
        windows.append(d)
    return {
        "run_id": "EXP003", "kind": "historical", "read_only": True,
        "title": "EXP003 recorded replay",
        "description": "Ten OBSERVED windows (random partition of the deployment domain; no time "
                       "axis) followed by ten INJECTED windows (declared severity ramp with recovery).",
        "state": "completed", "message": "Recorded historical replay",
        "created_at": rep["environment"]["timestamp_utc"], "finished_at": rep["environment"]["timestamp_utc"],
        "params": {"scenario": "exp003_recorded", "monitor_set": "four"},
        "windows_total": len(windows), "windows_completed": len(windows),
        "windows": windows, "audit": audit,
        "governance_summary": {"observed": rep["part_a_observed"]["governance"],
                               "injected": rep["part_b_injected"]["governance"]},
        "registry_version": audit[0]["registry_version"] if audit else None,
        "source": A.source("results/metrics/EXP003_replay.json", None, None,
                           "and results/audit/EXP003_audit.jsonl"),
    }


# --------------------------------------------------------------------------- manager
class ReplayManager:
    def __init__(self):
        self._busy = threading.Lock()
        self._state = threading.Lock()
        self._runs: dict[str, dict] = {}
        self._cancel: dict[str, threading.Event] = {}
        self._loaded = False

    # ----------------------------------------------------------- storage
    def _dir(self) -> Path:
        return get_settings().runs_dir

    def _load_stored(self):
        if self._loaded:
            return
        self._loaded = True
        root = self._dir()
        if not root.is_dir():
            return
        for d in root.iterdir():
            f = d / "run.json"
            if not (RUN_ID_RE.match(d.name) and f.is_file()):
                continue
            try:
                run = json.loads(f.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if run.get("state") not in TERMINAL:
                run["state"], run["message"] = "interrupted", "Server restarted while this run was active."
            self._runs[d.name] = run

    def _persist(self, run: dict, audit_trail=None):
        d = self._dir() / run["run_id"]
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "run.json.tmp"
        tmp.write_text(json.dumps(clean({k: v for k, v in run.items() if k != "audit"})))
        tmp.replace(d / "run.json")
        if audit_trail is not None:
            audit_trail.write(d / "audit.jsonl")
        self._prune()

    def _prune(self):
        keep = get_settings().max_stored_runs
        runs = sorted((r for r in self._runs.values() if r.get("kind") == "web" and r["state"] in TERMINAL),
                      key=lambda r: r["created_at"], reverse=True)
        for old in runs[keep:]:
            rid = old["run_id"]
            if RUN_ID_RE.match(rid) and rid != "EXP003":
                shutil.rmtree(self._dir() / rid, ignore_errors=True)
                self._runs.pop(rid, None)

    # ----------------------------------------------------------- queries
    def capabilities(self) -> dict:
        import sklearn
        s = get_settings()
        card = A.model_card()
        recorded = card.get("environment", {}).get("packages", {}).get("scikit-learn")
        ds = dataset.status()
        can_run = s.replay_enabled and (ds["present"] or ds["fetch_allowed"])
        reason = None
        if not s.replay_enabled:
            reason = "Replays are disabled on this deployment (HAVM_REPLAY_ENABLED=false)."
        elif not can_run:
            reason = ("The D2 dataset is not on this server and automatic download is disabled. "
                      "Browse the recorded EXP003 replay instead, or see the deployment guide.")
        exp1 = A.optional_json("results/metrics/EXP001_baselines.json") or {}
        return {
            "replay_enabled": s.replay_enabled, "can_start": can_run, "reason": reason,
            "bands": A.monitor_config()["governance"]["bands"],
            "deployment_encounters": exp1.get("provenance", {}).get("domain", {}).get("target_encounters"),
            "busy": self._busy.locked(), "dataset": ds,
            "timeout_seconds": s.replay_timeout_seconds,
            "scenarios": [
                {"id": "observed_partition", "label": "Observed: deployment-domain partition",
                 "evidence_class": "OBSERVED", "windows": {"min": 5, "max": 20, "default": 10},
                 "description": "Random partition of the emergency-admission domain into K windows. "
                                "D2 has no time axis, so this is a stability exercise, not a time series."},
                {"id": "injected_ramp", "label": "Injected: severity ramp with recovery",
                 "evidence_class": "INJECTED", "windows": {"fixed": len(RAMP)}, "severities": RAMP,
                 "description": "A declared perturbation (older, higher-utilisation case mix) applied "
                                "at severities 0 → 1 → 0. Injected; not clinical harm."},
            ],
            "monitor_sets": [
                {"id": "four", "label": "EXP003 configuration (A1, A3, calibration, fairness)",
                 "default": True},
                {"id": "seven", "label": "Extended: all seven monitors per window",
                 "default": False,
                 "note": "Applies the EXP008 monitor set per window (A4 telemetry SIMULATED). "
                         "A composition of the project's monitors, not a recorded experiment."},
            ],
            "sklearn": {"runtime": sklearn.__version__, "model_recorded": recorded,
                        "match": sklearn.__version__ == recorded},
            "live_integration": {"available": False,
                                 "reason": "No live clinical data source is configured or implemented. "
                                           "All monitoring evidence is historical, injected or simulated."},
        }

    def list_runs(self) -> list[dict]:
        self._load_stored()
        hist = _historical()
        runs = [hist] if hist else []
        with self._state:
            runs += sorted(self._runs.values(), key=lambda r: r["created_at"], reverse=True)
        return [self._public(r, windows=False) for r in runs]

    def _public(self, run: dict, windows: bool = True) -> dict:
        out = {k: v for k, v in run.items() if k not in ("windows", "audit")}
        if run.get("started_monotonic") and run["state"] not in TERMINAL:
            out["elapsed_seconds"] = round(time.monotonic() - run["started_monotonic"], 1)
        out.pop("started_monotonic", None)
        if windows:
            out["windows"] = [_summary(w) for w in run.get("windows", [])]
        return out

    def get(self, run_id: str) -> dict | None:
        if run_id == "EXP003":
            return _historical()
        self._load_stored()
        with self._state:
            run = self._runs.get(run_id)
            return copy.copy(run) if run else None

    def public(self, run_id: str) -> dict | None:
        run = self.get(run_id)
        return self._public(run) if run else None

    def window(self, run_id: str, window_id: str) -> dict | None:
        run = self.get(run_id)
        if not run:
            return None
        return next((w for w in list(run.get("windows", [])) if w["window_id"] == window_id), None)

    def audit_records(self, run_id: str) -> list[dict] | None:
        if run_id == "EXP003":
            try:
                return A.load_jsonl("results/audit/EXP003_audit.jsonl")
            except A.ArtifactMissing:
                return None
        run = self.get(run_id)
        if not run:
            return None
        f = self._dir() / run_id / "audit.jsonl"
        if f.is_file():
            return [json.loads(line) for line in f.read_text().splitlines() if line.strip()]
        return run.get("audit_live", [])

    # ----------------------------------------------------------- start
    def start(self, scenario: str, n_windows: int, seed: int, monitor_set: str) -> dict:
        self._load_stored()
        caps = self.capabilities()
        if not caps["can_start"]:
            raise PermissionError(caps["reason"])
        if not self._busy.acquire(blocking=False):
            raise BlockingIOError("A replay is already running. Wait for it to finish.")
        try:
            run_id = f"run-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{secrets.token_hex(3)}"
            total = n_windows if scenario == "observed_partition" else len(RAMP)
            run = {
                "run_id": run_id, "kind": "web", "read_only": False,
                "title": "Observed partition replay" if scenario == "observed_partition" else "Injected severity ramp",
                "description": None, "state": "queued", "message": "Queued",
                "created_at": _now(), "finished_at": None, "error": None,
                "params": {"scenario": scenario, "n_windows": total, "seed": seed, "monitor_set": monitor_set},
                "windows_total": total, "windows_completed": 0, "windows": [],
                "started_monotonic": time.monotonic(), "reproduction": None,
            }
            with self._state:
                self._runs[run_id] = run
            self._cancel[run_id] = threading.Event()
            threading.Thread(target=self._execute, args=(run_id,), name=f"replay-{run_id}", daemon=True).start()
            return self._public(run)
        except Exception:
            self._busy.release()
            raise

    def _set(self, run_id: str, **kw):
        with self._state:
            self._runs[run_id].update(kw)

    # ----------------------------------------------------------- execution
    def _execute(self, run_id: str):
        settings = get_settings()
        deadline = time.monotonic() + settings.replay_timeout_seconds
        run = self._runs[run_id]
        p = run["params"]
        audit = None
        try:
            self._set(run_id, state="preparing", message="Checking dataset")
            dataset.ensure(lambda msg: self._set(run_id, message=msg))
            audit = self._pipeline(run_id, p, deadline)
            self._set(run_id, state="completed", message="Completed", finished_at=_now())
            self._compare_with_recorded(run_id)
        except TimeoutError:
            self._set(run_id, state="timed_out", finished_at=_now(),
                      message=f"Stopped after the {settings.replay_timeout_seconds}s limit; "
                              "completed windows are kept.")
        except RuntimeError as exc:  # user-facing messages raised deliberately
            self._set(run_id, state="failed", finished_at=_now(), message="Failed", error=str(exc))
        except Exception as exc:
            log.exception("replay %s failed", run_id)
            self._set(run_id, state="failed", finished_at=_now(), message="Failed",
                      error=f"The replay pipeline raised {type(exc).__name__}. See server logs.")
        finally:
            import gc
            gc.collect()  # release the dataset frames before the next request (512 MB instances)
            try:
                with self._state:
                    snapshot = dict(self._runs[run_id])
                self._persist(snapshot, audit)
            except OSError:
                log.warning("could not persist run %s", run_id)
            self._busy.release()

    def _pipeline(self, run_id: str, p: dict, deadline: float):
        import joblib
        from havm import replay as havm_replay
        from havm.aggregation import compute_ahs
        from havm.datasets.d2 import build_splits
        from havm.governance import AuditTrail, GovernanceEngine
        from havm.triage import alert_packet, assess_harm
        from havm.utils import sha256_file

        g5 = _load_script("run_g5")

        self._set(run_id, state="preparing", message="Loading frozen model and registry")
        card = A.model_card()
        model_path = A.abs_path(card["artifact"])
        if sha256_file(model_path) != card["artifact_sha256"]:
            raise RuntimeError("Frozen model hash does not match its model card. Replay refused.")
        model = joblib.load(model_path)

        cfg = copy.deepcopy(A.dataset_config())
        cfg["dataset"]["raw_file"] = str(dataset.raw_path())
        registry = copy.deepcopy(A.registry_snapshot("EXP001"))
        registry["monitor_config"] = copy.deepcopy(A.monitor_config())
        registry["registry_version"] = "0.3.0"          # as in scripts/run_g5.py
        features = registry["model"]["features"]["numeric"] + registry["model"]["features"]["categorical"]
        label = cfg["label"]["name"]

        self._set(run_id, message="Building cohort and patient-grouped splits")
        splits = build_splits(cfg)
        reference, validation, deployment = splits.train, splits.validation, splits.target_sealed

        self._set(run_id, message="Measuring freeze-time baselines on validation")
        registry["freeze_baselines"] = g5.freeze_baselines(validation, reference, model, registry, features, label)
        review_band = registry["monitor_config"]["governance"]["bands"]["review"]

        monitor_fn = self._monitor_fn(p["monitor_set"], g5, reference, model, registry, features, label, run_id)

        if p["scenario"] == "observed_partition":
            windows = havm_replay.build("random_partition", df=deployment, n_windows=p["n_windows"], seed=p["seed"])
        else:
            base = deployment.sample(n=min(8000, len(deployment)), random_state=p["seed"])
            frames = [(f"R{i:02d}", g5.perturb(base, s, seed=1000 + i, n_out=8000),
                       {"evidence_class": "INJECTED", "severity": s}) for i, s in enumerate(RAMP)]
            windows = havm_replay.build("sequence", frames=frames)

        engines = {v: GovernanceEngine(registry, variant=v)
                   for v in registry["monitor_config"]["governance"]["variants"]}
        audit = AuditTrail(registry)
        self._set(run_id, state="running", message="Processing windows")

        for index, (window_id, frame, meta) in enumerate(windows):
            if time.monotonic() > deadline:
                raise TimeoutError
            if self._cancel[run_id].is_set():
                raise RuntimeError("Run cancelled.")
            results = monitor_fn(window_id, index, frame)
            ahs_result = compute_ahs(results, registry)
            harm = assess_harm(results, ahs_result, registry)
            decisions = {v: e.step(window_id, ahs_result["ahs"], harm if v == "separated" else None)
                         for v, e in engines.items()}
            packet = alert_packet(window_id, results, ahs_result, harm, decisions["separated"], registry)
            audit.record(window_id=window_id, window_meta=meta, results=results, ahs_result=ahs_result,
                         harm=harm, governance=decisions, packet=packet)
            detail = _detail_from_parts(window_id=window_id, index=index, meta=meta, results=results,
                                        ahs_result=ahs_result, harm=harm, decisions=decisions,
                                        packet=packet, review_band=review_band, monitor_evidence=True)
            detail["part"] = "injected" if meta.get("evidence_class") == "INJECTED" else "observed"
            detail["recorded_at"] = audit.records[-1]["timestamp"]
            with self._state:
                r = self._runs[run_id]
                r["windows"].append(detail)
                r["windows_completed"] = len(r["windows"])
                r["audit_live"] = clean(audit.records)
                r["message"] = f"Processed {window_id}"

        with self._state:
            r = self._runs[run_id]
            r["governance_summary"] = clean({v: e.summary() for v, e in engines.items()})
            r["registry_version"] = registry["registry_version"]
            r["freeze_baselines"] = clean(registry["freeze_baselines"])
            r.pop("audit_live", None)
        return audit

    def _monitor_fn(self, monitor_set, g5, reference, model, registry, features, label, run_id):
        if monitor_set == "four":
            # The exact EXP003 monitor set, imported from scripts/run_g5.py.
            return lambda wid, i, frame: g5.run_monitors(frame, reference, model, registry, features, label)

        from havm.monitors.ood import TabularOOD, ood_monitor
        from havm.monitors.relational import operational_monitor, relational_monitor, simulate_batch

        self._set(run_id, message="Fitting OOD detector on the reference set")
        numeric = registry["model"]["features"]["numeric"]
        categorical = registry["model"]["features"]["categorical"]
        detector = registry["monitor_config"]["monitors"]["ood"]["detector"]
        ood = TabularOOD(numeric, categorical).fit(reference, reference[label])
        ref_probs = model.predict_proba(reference[features])[:, 1]
        ref_scores = ood.scores(reference, ref_probs)[detector]

        def seven(wid, i, frame):
            four = {r["monitor"]: r for r in g5.run_monitors(frame, reference, model, registry, features, label)}
            probs = model.predict_proba(frame[features])[:, 1]
            a2 = relational_monitor(frame[label].to_numpy(), probs, ref_probs, registry,
                                    labels_available=True).to_dict()
            a4 = operational_monitor(simulate_batch(wid, seed=i), registry).to_dict()
            od = ood_monitor(ood.scores(frame, probs)[detector], ref_scores, registry, detector).to_dict()
            # EXP008 ordering
            return [four["a1_distribution"], a2, four["a3_structural"], a4, od,
                    four["calibration"], four["fairness"]]
        return seven

    def _compare_with_recorded(self, run_id: str):
        """Does this run reproduce the recorded EXP003 numbers? Only meaningful for the
        default parameters; reported, never assumed."""
        run = self._runs[run_id]
        p = run["params"]
        hist = _historical()
        if not hist or p["monitor_set"] != "four" or p["seed"] != 20260819:
            self._set(run_id, reproduction={"comparable": False,
                                            "reason": "Only the default seed with the EXP003 monitor set "
                                                      "is comparable with the recorded run."})
            return
        part = "observed" if p["scenario"] == "observed_partition" else "injected"
        recorded = [w for w in hist["windows"] if w["part"] == part]
        if len(recorded) != len(run["windows"]):
            self._set(run_id, reproduction={"comparable": False,
                                            "reason": "Window count differs from the recorded run."})
            return
        diffs = [abs(a["ahs"] - b["ahs"]) for a, b in zip(run["windows"], recorded)]
        same_states = all(a["states"] == b["states"] for a, b in zip(run["windows"], recorded))
        self._set(run_id, reproduction={"comparable": True, "max_abs_ahs_difference": max(diffs),
                                        "governance_states_identical": same_states,
                                        "reproduces_recorded": max(diffs) < 1e-6 and same_states,
                                        "compared_with": f"EXP003 {part} windows"})


manager = ReplayManager()
