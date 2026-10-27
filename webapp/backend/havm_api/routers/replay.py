"""Replay and demo lab."""
from __future__ import annotations

from fastapi import APIRouter, Path as P

from havm_api.errors import ApiError
from havm_api.schemas import Envelope, ErrorResponse, ReplayRequest, RunStatus
from havm_api.services.replay import RUN_ID_RE, WINDOW_ID_RE, manager

router = APIRouter(prefix="/api/replay", tags=["replay"])
RUN = P(..., max_length=40, description="EXP003 or run-YYYYMMDD-HHMMSS-xxxxxx")
ERR = {404: {"model": ErrorResponse}, 409: {"model": ErrorResponse},
       422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}}


def _check(run_id: str):
    if not RUN_ID_RE.match(run_id):
        raise ApiError(422, "invalid_run_id", "Run ids are EXP003 or run-YYYYMMDD-HHMMSS-xxxxxx.")


@router.get("/capabilities", response_model=Envelope)
def capabilities():
    """Whether a replay can start here, dataset status, scenarios and monitor sets."""
    return Envelope(data=manager.capabilities())


@router.get("", response_model=Envelope)
def runs():
    """The recorded EXP003 replay plus runs started from this server."""
    return Envelope(data=manager.list_runs())


@router.post("", response_model=RunStatus, status_code=202, responses=ERR)
def start(req: ReplayRequest):
    """Start a replay of the existing pipeline. One run at a time; returns immediately."""
    try:
        run = manager.start(req.scenario, req.n_windows, req.seed, req.monitor_set)
    except BlockingIOError as exc:
        raise ApiError(409, "replay_busy", str(exc))
    except PermissionError as exc:
        raise ApiError(503, "replay_unavailable", str(exc))
    return run


@router.get("/{run_id}", response_model=RunStatus, responses=ERR)
def get_run(run_id: str = RUN):
    _check(run_id)
    run = manager.public(run_id)
    if not run:
        raise ApiError(404, "run_not_found", f"No run {run_id}.")
    return run


@router.get("/{run_id}/windows", response_model=Envelope, responses=ERR)
def windows(run_id: str = RUN):
    _check(run_id)
    run = manager.public(run_id)
    if not run:
        raise ApiError(404, "run_not_found", f"No run {run_id}.")
    return Envelope(data=run["windows"], meta={"run_id": run_id, "state": run["state"]})


@router.get("/{run_id}/windows/{window_id}", response_model=Envelope, responses=ERR)
def window(run_id: str = RUN, window_id: str = P(..., max_length=6)):
    """Full window: monitor outputs, AHS decomposition, harm, both governance variants, alert packet."""
    _check(run_id)
    if not WINDOW_ID_RE.match(window_id):
        raise ApiError(422, "invalid_window_id", "Window ids look like W003 or R07.")
    w = manager.window(run_id, window_id)
    if not w:
        raise ApiError(404, "window_not_found", f"No window {window_id} in {run_id}.")
    return Envelope(data=w, meta={"run_id": run_id})
