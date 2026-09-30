from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.schemas.submit import ErrorResponse, SubmitAccepted, SubmitRejected, SubmitRequest
from app.services import detector

router = APIRouter()


# The payload is returned as-is (not through a response_model) so `null` values such as `ml_probability` are
# kept, exactly as the stdlib server sends them. The models below only document the two outcomes.
@router.post(
    "/submit",
    response_class=JSONResponse,
    responses={
        200: {"model": SubmitAccepted, "description": "Accepted; `sanitized` holds HTML-escaped values"},
        422: {"model": SubmitRejected, "description": "Rejected; `errors` maps field -> message"},
        400: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
    },
    summary="Validate a form submission: block XSS, check email and website",
)
def submit(body: SubmitRequest) -> JSONResponse:
    """Decide whether a form submission may be accepted.

    Every field is scanned for XSS. The submission is **rejected (422)** if any field looks malicious, if `email`
    (when present) is not an email address, or if `website` (when present) is not an `http://`/`https://` URL.
    `errors` maps each failing field to a message; `results` always carries the scan of every field.

    If everything passes the reply is **200** and `sanitized` holds an HTML-escaped copy of each value, safe to
    render as text. A field named `email` or `website` gets those extra checks; any other names are only scanned.
    """
    status, payload = detector.submit_fields(body.fields)
    return JSONResponse(status_code=status, content=payload)
