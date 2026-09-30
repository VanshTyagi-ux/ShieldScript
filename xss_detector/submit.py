"""Form-submission policy shared by every server (the stdlib one and the FastAPI backend).

Framework-free on purpose: it takes a detector and a dict of strings and returns (status, payload), so the
rules for what gets rejected live in exactly one place.
"""

from __future__ import annotations

import logging
import re

from .sanitizer import escape_html, safe_url

EMAIL_RE = re.compile(r"[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+")

# Same logger name as before the extraction, so existing log filters and tests keep matching.
log = logging.getLogger("xss_detector.server")


def review_submission(detector, fields: dict[str, str]) -> tuple[int, dict]:
    """Scan every field; reject (422) malicious ones, a bad email or a non-http(s) website, else accept (200)
    with HTML-escaped copies of the values. `detector` is anything with `.scan(text) -> dict`."""
    results = {name: detector.scan(value) for name, value in fields.items()}
    errors = {}
    for name, result in results.items():
        if result["is_malicious"]:
            errors[name] = f"Potential XSS detected ({result['level']}, score {result['score']})"
            log.warning("blocked field=%r level=%s score=%d ml=%s rules=%s", name, result["level"],
                        result["score"], result["ml_probability"], [f["rule_id"] for f in result["findings"]])
    email = fields.get("email", "").strip()
    if email and not EMAIL_RE.fullmatch(email):
        errors.setdefault("email", "Invalid email address")
    website = fields.get("website", "").strip()
    if website and (safe_url(website) is None or "://" not in website):
        errors.setdefault("website", "Website must start with http:// or https://")

    if errors:
        return 422, {"accepted": False, "errors": errors, "results": results}
    return 200, {"accepted": True,
                 "sanitized": {k: escape_html(v) for k, v in fields.items()},
                 "results": results}
