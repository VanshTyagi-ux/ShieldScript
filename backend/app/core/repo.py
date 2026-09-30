"""Locate the repository root and make the `xss_detector` package (which lives there) importable.

The backend runs from backend/, so the repo root is not on sys.path by default.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # core -> app -> backend -> repo root
PAYLOAD_DIR = REPO_ROOT / "data" / "payloads"


def ensure_repo_importable() -> None:
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
