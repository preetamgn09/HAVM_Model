"""HAVM | Clinical AI Observability — FastAPI application.

    uvicorn havm_api.main:app --app-dir webapp/backend

Serves the JSON API under /api (OpenAPI docs at /api/docs) and, when the frontend has been
built, the single-page application from webapp/frontend/dist. Run with ONE worker: replay
state and the one-run-at-a-time lock live in process memory.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from havm_api import __version__, errors
from havm_api.config import get_settings
from havm_api.routers import core, governance, replay, research

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _finite(obj: Any) -> Any:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


class SafeJSONResponse(JSONResponse):
    """Research artefacts can contain NaN; strict JSON cannot. Non-finite floats become null."""

    def render(self, content: Any) -> bytes:
        return json.dumps(_finite(content), ensure_ascii=False, separators=(",", ":"), default=str).encode()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="HAVM | Clinical AI Observability API",
        version=__version__,
        description="Read-only access to the HAVM capstone's recorded research artefacts, plus "
                    "replays of the existing pipeline on retrospective public data. Research "
                    "prototype: not clinically validated, no live patient data, and every "
                    "governance output is a simulated policy decision.",
        docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json",
        default_response_class=SafeJSONResponse,
    )
    errors.install(app)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if s.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(s.cors_origins),
                           allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/api/") and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response

    for r in (core.router, research.router, governance.router, replay.router):
        app.include_router(r)

    dist = s.frontend_dist
    index = dist / "index.html"
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            return SafeJSONResponse({"error": {"code": "not_found", "message": "Unknown API route."}},
                                    status_code=404)
        candidate = (dist / full_path).resolve()
        if full_path and dist in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return SafeJSONResponse({"error": {"code": "frontend_not_built",
                                           "message": "The frontend has not been built. Run `npm run build` "
                                                      "in webapp/frontend, or use the API at /api/docs."}},
                                status_code=503)

    return app


app = create_app()
