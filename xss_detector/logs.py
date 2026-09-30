"""Logging setup: readable text by default, one JSON object per line for log aggregators (LOG_FORMAT=json)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from .config import Config

TEXT_FORMAT = "%(asctime)s %(levelname)s %(message)s"
REQUEST_FIELDS = ("method", "path", "status", "duration_ms", "client", "request_id")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        for key in REQUEST_FIELDS:
            if hasattr(record, key):
                data[key] = getattr(record, key)
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, default=str)  # one line: newlines inside values are escaped


def configure_logging(config: Config) -> None:
    """Send all logging to stderr in the configured format and level, replacing earlier handlers so that
    calling this twice does not print every line twice."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter() if config.log_format == "json" else logging.Formatter(TEXT_FORMAT))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(config.log_level)
