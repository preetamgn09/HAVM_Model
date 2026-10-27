"""Request and response schemas.

Requests are strictly validated. Responses carrying research artefacts keep the artefact's
own nested structure (typed as dict) inside a validated envelope, so that the API does not
silently reshape or drop fields from the recorded results.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MonitorId = Literal["a1_distribution", "a2_relational", "a3_structural", "a4_operational",
                    "ood", "calibration", "fairness"]
BankMonitor = Literal["a1_distribution", "a3_structural", "calibration", "fairness"]
State = Literal["NORMAL", "MONITOR", "GOVERNANCE_REVIEW", "HUMAN_REVIEW_REQUIRED",
                "ABSTENTION_RECOMMENDED", "AUTOMATED_PREDICTION_SUSPENSION"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- requests
class ReplayRequest(Strict):
    scenario: Literal["observed_partition", "injected_ramp"] = "observed_partition"
    n_windows: int = Field(10, ge=5, le=20, description="Observed partition only; the ramp has 10 windows.")
    seed: int = Field(20260819, ge=0, le=2**31 - 1)
    monitor_set: Literal["four", "seven"] = "four"


class PolicyRequest(Strict):
    weights: dict[BankMonitor, float] = Field(..., description="Relative weights; renormalised over active monitors.")
    band: float = Field(0.75, gt=0.0, lt=1.0, description="AHS review band: alert when AHS < band.")
    normalisation: Literal["threshold_relative", "soft_exponential", "empirical_quantile", "linear_clip"] = "threshold_relative"
    ablate: list[BankMonitor] = Field(default_factory=list)
    bootstrap: int = Field(0, ge=0, le=2000)
    seed: int = Field(20260819, ge=0, le=2**31 - 1)

    @field_validator("weights")
    @classmethod
    def _non_negative(cls, v):
        if any(w < 0 or w > 100 for w in v.values()):
            raise ValueError("weights must be between 0 and 100")
        return v

    @model_validator(mode="after")
    def _something_active(self):
        active = [m for m, w in self.weights.items() if w > 0 and m not in self.ablate]
        if not active:
            raise ValueError("at least one non-ablated monitor needs a positive weight")
        return self


class GovernanceStep(Strict):
    ahs: float = Field(..., ge=0.0, le=1.0)
    harm_level: Literal["NONE", "POTENTIAL", "MEASURED"]
    input_change: bool = False


class GovernanceSimRequest(Strict):
    steps: list[GovernanceStep] = Field(..., min_length=1, max_length=50)


# --------------------------------------------------------------------------- responses
class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    artefacts: dict[str, bool]
    replay: dict[str, Any]
    frontend_built: bool


class Envelope(BaseModel):
    """Generic validated envelope: data plus provenance metadata."""
    data: Any
    meta: dict[str, Any] = Field(default_factory=dict)


class AuditPage(BaseModel):
    source: str
    total: int
    offset: int
    limit: int
    rows: list[dict[str, Any]]
    filters: dict[str, Any]
    historical: bool


class RunStatus(BaseModel):
    model_config = ConfigDict(extra="allow")
    run_id: str
    kind: Literal["historical", "web"]
    state: Literal["queued", "preparing", "running", "completed", "failed", "timed_out", "interrupted"]
    message: str | None = None
    windows_total: int
    windows_completed: int
    params: dict[str, Any]
    windows: list[dict[str, Any]] | None = None


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
