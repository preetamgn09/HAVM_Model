"""Monitors, performance and the research evidence lab."""
from __future__ import annotations

from fastapi import APIRouter

from havm_api.errors import ApiError
from havm_api.schemas import Envelope, ErrorResponse, MonitorId, PolicyRequest
from havm_api.services import evidence as E
from havm_api.services import monitors as M
from havm_api.services import performance as PF

router = APIRouter(prefix="/api", tags=["research"])


@router.get("/monitors", response_model=Envelope)
def monitors():
    """All seven monitors: configuration, freeze baselines and the full-domain EXP008 snapshot."""
    return Envelope(data=M.list_monitors())


@router.get("/monitors/{monitor_id}", response_model=Envelope, responses={422: {"model": ErrorResponse}})
def monitor(monitor_id: MonitorId):
    """One monitor with its per-window series (EXP003, EXP004-006) and detailed evidence."""
    return Envelope(data=M.monitor_detail(monitor_id))


@router.get("/performance", response_model=Envelope)
def performance():
    """Validation metrics for the candidates (EXP001) and deployment metrics (EXP008), kept separate."""
    return Envelope(data=PF.performance())


@router.get("/evidence", response_model=Envelope)
def evidence():
    """Every Evidence Lab dataset, read from the recorded experiment files."""
    return Envelope(data=E.lab())


@router.get("/evidence/findings", response_model=Envelope)
def findings():
    return Envelope(data=E.findings())


@router.get("/evidence/ood-distributions", response_model=Envelope)
def ood_distributions():
    """Binned detector-score densities for each OOD group vs the remainder (aggregates only)."""
    try:
        return Envelope(data=E.paediatric_distributions())
    except Exception:
        raise ApiError(503, "artefact_unavailable", "Per-record OOD score export (EXP011) is not available.")


@router.get("/evidence/policy/defaults", response_model=Envelope)
def policy_defaults():
    return Envelope(data=E.policy_defaults())


@router.post("/evidence/policy", response_model=Envelope, responses={422: {"model": ErrorResponse}})
def policy(req: PolicyRequest):
    """Recompute detection metrics on the stored EXP005 window bank under a different AHS
    policy, using havm.sweep.rescore. The default policy reproduces the recorded results."""
    try:
        data = E.rescore_policy(dict(req.weights), req.band, req.normalisation, list(req.ablate),
                                req.bootstrap, req.seed)
    except ValueError as exc:
        raise ApiError(422, "invalid_policy", str(exc))
    return Envelope(data=data, meta={"recomputed": True})
