"""Consistent error envelope: {"error": {"code": ..., "message": ...}}.

Exception details and filesystem paths are never returned to the client."""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("havm_api")


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(status_code=status_code, detail={"code": code, "message": message})


def _body(code: str, message: str, extra: dict | None = None) -> dict:
    payload = {"code": code, "message": message}
    if extra:
        payload.update(extra)
    return {"error": payload}


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            return JSONResponse(_body(detail["code"], detail["message"]), status_code=exc.status_code)
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(_body(code, str(detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        issues = [{"field": ".".join(str(p) for p in e.get("loc", [])[1:]), "message": e.get("msg")}
                  for e in exc.errors()]
        return JSONResponse(_body("invalid_request", "Request validation failed.", {"issues": issues}),
                            status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error: %s", type(exc).__name__)
        return JSONResponse(_body("internal_error", "The server could not complete this request."),
                            status_code=500)
