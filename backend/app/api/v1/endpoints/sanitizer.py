import logging

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.sanitize import DetectorAlert, SanitizeRequest, SanitizeResponse, SanitizationReport
from app.schemas.submit import ErrorResponse
from app.services import detector, sanitizer

router = APIRouter()
log = logging.getLogger("app.sanitizer")


@router.post(
    "/sanitize",
    response_model=SanitizeResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Body is not JSON or `html` is missing or not a string"},
        413: {"model": ErrorResponse, "description": "The HTML is longer than the configured limit"},
        503: {"model": ErrorResponse, "description": "The sanitizer library is not installed (fails closed)"},
    },
    summary="Sanitize rich text / HTML",
)
def sanitize(body: SanitizeRequest) -> SanitizeResponse:
    """Clean an HTML fragment with a fixed allow-list and report what was removed.

    **Use `clean` and nothing else.** Store and render only the returned `clean` string, as HTML body content
    (not inside an attribute, `<script>`, `<style>` or a URL) and keep your own CSP.

    **Policy** (not configurable per request):
    - Tags kept: `a b i em strong p br ul ol li blockquote code pre h1 h2 h3 h4 img`. Any other tag is removed
      but its text stays; `script` and `style` are removed together with their contents.
    - Attributes kept: `a` gets `href` and `title`, `img` gets `src` and `alt`. Everything else goes, including
      every `on*` handler, `style` and `class`.
    - URLs must be `http`, `https`, `mailto` or relative; `javascript:`, `data:` and `vbscript:` are dropped.
    - Links get `rel="noopener noreferrer"`. HTML comments are stripped.

    **`report`** lists the removed tags and attributes with counts and a reason. It is a best-effort summary
    derived by comparing input and output; on badly malformed markup it can differ from what a browser would
    parse. It never affects `clean`.

    **`detector`** is the XSS detector's verdict on the raw input. It is an alert signal only and never blocks.

    Limits: `html` may be at most `MAX_HTML_LENGTH` characters (64 000 by default), because sanitizing deeply
    nested markup gets slow. If the sanitizer library is missing the endpoint answers 503 instead of returning
    unsanitized input.
    """
    limit = settings.MAX_HTML_LENGTH
    if len(body.html) > limit:
        raise HTTPException(status_code=413, detail=f"HTML must be at most {limit} characters")
    try:
        outcome = sanitizer.sanitize(body.html)
    except sanitizer.SanitizerUnavailable:
        raise HTTPException(status_code=503, detail="HTML sanitizer unavailable")

    scan = detector.scan_text(body.html)
    alert = DetectorAlert(score=scan["score"], level=scan["level"], is_malicious=scan["is_malicious"],
                          ml_probability=scan["ml_probability"], rule_ids=[f["rule_id"] for f in scan["findings"]])
    if alert.is_malicious:  # rule ids only: the input itself is never logged
        log.warning("sanitize: detector flagged input level=%s score=%d rules=%s tags_removed=%d",
                    alert.level, alert.score, alert.rule_ids, outcome.report.total_tags_removed)
    return SanitizeResponse(clean=outcome.clean, changed=outcome.changed,
                            report=SanitizationReport(**vars(outcome.report)), detector=alert)
