"""Bridge to the detector package that lives at the repository root (`xss_detector/`).

The detector is built once per process (rules + ML) and shared: scanning is read-only, so threads can share it.
"""

from __future__ import annotations

from app.core.repo import ensure_repo_importable

ensure_repo_importable()

from xss_detector.catalog import rules_payload as _rules_payload  # noqa: E402
from xss_detector.ml import HybridDetector  # noqa: E402
from xss_detector.submit import review_submission  # noqa: E402

detector = HybridDetector()  # ML is skipped automatically if xss_detector/model.json is missing


def rule_count() -> int:
    return len(detector.rules.rules)


def ml_loaded() -> bool:
    return detector.ml is not None


def rules_catalog() -> dict:
    """The rule catalog, identical to what the stdlib server's /api/rules returns."""
    return _rules_payload(detector.rules.block_threshold)


def scan_text(text: str) -> dict:
    return detector.scan(text)


def scan_fields(fields: dict[str, str]) -> dict[str, dict]:
    return {name: detector.scan(value) for name, value in fields.items()}


def submit_fields(fields: dict[str, str]) -> tuple[int, dict]:
    """(200, accepted payload) or (422, rejected payload); same policy as the stdlib server."""
    return review_submission(detector, fields)
