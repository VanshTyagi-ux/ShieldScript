"""Error responses in the API's one error shape, `{"error": "<message>"}`.

FastAPI's defaults are `{"detail": ...}` (and 422 for a bad body). The existing React app reads `data.error`
and 422 already means "submission rejected" here, so these handlers keep the same contract as the stdlib
server: malformed requests are 400 with a short message.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app.errors")

_BY_ROUTE = {
    "/scan": "Provide 'text' (string) or 'fields' (object)",
    "/submit": "'fields' must be an object of strings",
    "/sanitize": "Provide 'html' (string)",
}


def _validation_message(request: Request, errors: list[dict]) -> str:
    kinds = {e.get("type") for e in errors}
    if "json_invalid" in kinds:
        return "Body must be valid JSON"
    if "model_attributes_type" in kinds:
        return "Body must be a JSON object"
    params = [e for e in errors if tuple(e.get("loc", ()))[:1] in (("query",), ("path",))]
    if params:  # e.g. "limit: Input should be less than or equal to 500"
        return "; ".join(f"{e['loc'][-1]}: {e['msg']}" for e in params)
    for suffix, message in _BY_ROUTE.items():
        if request.url.path.endswith(suffix):
            return message
    return "Invalid request"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"error": _validation_message(request, exc.errors())})

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # A bug, a missing table, a database outage... Keep the error shape and never leak details to the client.
        log.error("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(status_code=500, content={"error": "Internal server error"})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # "Not Found" is Starlette's default for an unknown route; an endpoint's own 404 detail is kept.
        message = "Not found" if exc.status_code == 404 and exc.detail in (None, "Not Found") else str(exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"error": message}, headers=exc.headers)
