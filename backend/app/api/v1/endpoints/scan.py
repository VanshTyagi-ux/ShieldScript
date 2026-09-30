from fastapi import APIRouter

from app.schemas.scan import FieldsScanResponse, ScanRequest, ScanResult
from app.schemas.submit import ErrorResponse
from app.services import detector

router = APIRouter()


# Plain `def` (not async): a scan is CPU-bound regex work, so FastAPI runs it in its threadpool instead of
# blocking the event loop.
@router.post(
    "/scan",
    response_model=ScanResult | FieldsScanResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Body is not a JSON object, or neither `text` nor `fields` is valid"},
        413: {"model": ErrorResponse, "description": "The request body is larger than MAX_BODY bytes"},
    },
    summary="Scan text, or a set of form fields, for XSS",
)
def scan(body: ScanRequest) -> dict:
    """Score input for cross-site scripting with the hybrid detector (decoding-aware rules, then an ML second
    opinion that can only raise the verdict).

    Send **either** one string in `text` **or** an object of named strings in `fields` (if both are sent,
    `fields` wins). The reply for `text` is one result; for `fields` it is `{"results": {field: result}}`.

    Each result has a `score` (0-100), a `level` (safe, low, medium, high, critical), `is_malicious` (true from
    score 25, or when the ML model is very confident and a rule matched), the `decoded` text the rules saw and
    how many decoding layers that took, and the `findings` (rule, weight, matched text and position).

    Detection is heuristic: always encode output and use a CSP as well.
    """
    if body.fields is not None:
        return {"results": detector.scan_fields(body.fields)}
    return detector.scan_text(body.text)
