"""In-memory log of recent scans, shown on the site's /live page.

Only scans that name a `source` are recorded. Input text is kept (cut to MAX_TEXT characters) so the page can show
what was caught; nothing is written to disk.
"""

from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone

MAX_TEXT = 200


class EventLog:
    def __init__(self, maxlen: int = 100):
        self._events: deque[dict] = deque(maxlen=maxlen)
        self._next_id = 1
        self._lock = threading.Lock()

    def add(self, *, source: str, field: str, blocked: bool, score: int, level: str,
            rules: list[str], text: str) -> dict:
        with self._lock:
            event = {
                "id": self._next_id,
                "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                "source": source, "field": field, "blocked": blocked, "score": score, "level": level,
                "rules": list(rules), "text": text[:MAX_TEXT],
            }
            self._next_id += 1
            self._events.append(event)
            return event

    def snapshot(self) -> list[dict]:
        """The stored events, newest first."""
        with self._lock:
            return list(reversed(self._events))
