"""Governance, registry and audit."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse, Response

from havm_api import artifacts as A
from havm_api.errors import ApiError
from havm_api.schemas import AuditPage, Envelope, ErrorResponse, GovernanceSimRequest, State
from havm_api.services import audit as AU
from havm_api.services import governance as G
from havm_api.services import registry as R
from havm_api.services.replay import RUN_ID_RE, manager

router = APIRouter(prefix="/api", tags=["governance"])
Snapshot = Literal["EXP001", "EXP002", "EXP003", "EXP008"]
ERR = {404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}}


@router.get("/governance", response_model=Envelope)
def governance():
    """States, rules, configuration and the recorded EXP003 transition timeline."""
    return Envelope(data=G.overview(), meta={"evidence_class": "SIMULATED"})


@router.post("/governance/simulate", response_model=Envelope, responses=ERR)
def simulate(req: GovernanceSimRequest):
    """Step the real GovernanceEngine through up to 50 user-defined windows."""
    return Envelope(data=G.simulate([s.model_dump() for s in req.steps]),
                    meta={"evidence_class": "SIMULATED"})


@router.get("/registry", response_model=Envelope)
def registry():
    """Saved registry snapshots (historical, read-only) and the currently loaded configuration."""
    return Envelope(data={"snapshots": R.snapshots(), "current": R.current()})


@router.get("/registry/diff", response_model=Envelope, responses=ERR)
def registry_diff(a: Snapshot = Query(...), b: Snapshot = Query(...)):
    return Envelope(data=R.diff(a, b))


@router.get("/registry/{snapshot_id}", response_model=Envelope, responses=ERR)
def registry_snapshot(snapshot_id: Snapshot):
    try:
        return Envelope(data=R.snapshot(snapshot_id), meta={"read_only": True})
    except A.ArtifactMissing:
        raise ApiError(404, "snapshot_not_found", f"Registry snapshot {snapshot_id} is not available.")


def _rows(source: str) -> list[dict]:
    if not RUN_ID_RE.match(source):
        raise ApiError(422, "invalid_source", "source must be EXP003 or a replay run id.")
    recs = manager.audit_records(source)
    if recs is None:
        raise ApiError(404, "audit_not_found", f"No audit records for {source}.")
    return [AU.row(i, r, source) for i, r in enumerate(recs)]


@router.get("/audit", response_model=AuditPage, responses=ERR)
def audit(source: str = Query("EXP003", max_length=40),
          q: str | None = Query(None, max_length=80),
          state: State | None = None,
          event: Literal["escalation", "de_escalation", "held", "steady"] | None = None,
          harm: Literal["NONE", "POTENTIAL", "MEASURED"] | None = None,
          window: str | None = Query(None, pattern=r"^[A-Za-z]\d{0,3}$"),
          evidence: Literal["OBSERVED", "INJECTED", "SIMULATED"] | None = None,
          offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    """Searchable, paginated audit rows. Original records are not modified."""
    rows = AU.filter_rows(_rows(source), q=q, state=state, event=event, harm=harm, window=window, evidence=evidence)
    return AuditPage(source=source, total=len(rows), offset=offset, limit=limit, rows=rows[offset:offset + limit],
                     filters={"q": q, "state": state, "event": event, "harm": harm, "window": window,
                              "evidence": evidence}, historical=source == "EXP003")


@router.get("/audit/export", responses=ERR)
def audit_export(source: str = Query("EXP003", max_length=40), format: Literal["json", "csv"] = "json",
                 q: str | None = Query(None, max_length=80), state: State | None = None,
                 event: Literal["escalation", "de_escalation", "held", "steady"] | None = None,
                 harm: Literal["NONE", "POTENTIAL", "MEASURED"] | None = None,
                 window: str | None = Query(None, pattern=r"^[A-Za-z]\d{0,3}$"),
                 evidence: Literal["OBSERVED", "INJECTED", "SIMULATED"] | None = None):
    """Download the filtered audit rows. JSON export includes the full original records."""
    rows = AU.filter_rows(_rows(source), q=q, state=state, event=event, harm=harm, window=window, evidence=evidence)
    name = f"havm_audit_{source}"
    if format == "csv":
        return PlainTextResponse(AU.to_csv(rows), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    import json
    recs = manager.audit_records(source)
    full = [recs[r["index"]] for r in rows]
    body = json.dumps({"source": source, "historical": source == "EXP003", "n_records": len(full),
                       "records": full}, default=str, indent=2)
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}.json"'})


@router.get("/audit/{source}/{index}", response_model=Envelope, responses=ERR)
def audit_record(source: str, index: int):
    """One original audit record, exactly as written by havm.governance.AuditTrail."""
    if not RUN_ID_RE.match(source):
        raise ApiError(422, "invalid_source", "source must be EXP003 or a replay run id.")
    recs = manager.audit_records(source)
    if recs is None or not 0 <= index < len(recs):
        raise ApiError(404, "audit_record_not_found", "No such audit record.")
    return Envelope(data=recs[index], meta={"source": source, "index": index, "historical": source == "EXP003"})
