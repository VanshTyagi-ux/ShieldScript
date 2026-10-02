"""Scan history: every scan the server answers, kept in a SQLite file (standard library only).

The input text is real user data, so it is cut to MAX_TEXT characters and the table is capped at MAX_ROWS rows,
oldest first out. The server decides whether to open a store at all (see config.store_enabled).
"""

from __future__ import annotations

import csv
import io
import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

MAX_TEXT = 1000
MAX_ROWS = 10_000
COLLAPSE_SECONDS = 3.0
FILTERS = ("all", "blocked", "allowed")
CSV_COLUMNS = ["id", "ts", "source", "field", "text", "blocked", "score", "level", "rules", "ml_probability",
               "decode_layers"]
_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")

_SCHEMA = """CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, source TEXT NOT NULL, field TEXT NOT NULL,
    text TEXT NOT NULL, blocked INTEGER NOT NULL, score INTEGER NOT NULL, level TEXT NOT NULL,
    rules TEXT NOT NULL, ml_probability REAL, decode_layers INTEGER NOT NULL)"""
_COLUMNS = ", ".join(CSV_COLUMNS)


def _row(record: tuple) -> dict:
    row = dict(zip(CSV_COLUMNS, record))
    row["blocked"] = bool(row["blocked"])
    row["rules"] = json.loads(row["rules"])
    return row


class ScanStore:
    """One SQLite connection shared by every request thread, guarded by a lock."""

    def __init__(self, path: str | Path, max_rows: int = MAX_ROWS, clock: Callable[[], float] = time.time):
        self._max_rows = max_rows
        self._clock = clock
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        with self._db:
            self._db.execute(_SCHEMA)

    def add(self, **row) -> None:
        """Record one scanned field; `row` has the keys add_many documents."""
        self.add_many([row])

    def add_many(self, rows: list[dict]) -> None:
        """Record several scanned fields (one request's worth) in a single transaction. Each row is a dict with
        source (str or None), field, text, blocked, score, level, rules, ml_probability and decode_layers. While
        someone is still typing (same source and field, new text extends the previous row's text, within
        COLLAPSE_SECONDS) the previous row is updated instead of adding another; a repeat of the previous row's
        text is dropped. The row cap is applied once, after the batch."""
        if not rows:
            return
        with self._lock, self._db:
            for row in rows:
                self._add_one(**row)
            self._db.execute("DELETE FROM scans WHERE id <= (SELECT MAX(id) FROM scans) - ?", (self._max_rows,))

    def _add_one(self, *, source: str | None, field: str, text: str, blocked: bool, score: int, level: str,
                 rules: list[str], ml_probability: float | None, decode_layers: int) -> None:
        source = source or ""
        text = text[:MAX_TEXT]
        now = self._clock()
        ts = datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="milliseconds")
        values = (ts, text, int(blocked), score, level, json.dumps(rules), ml_probability, decode_layers)
        last = self._db.execute("SELECT id, ts, source, field, text FROM scans ORDER BY id DESC LIMIT 1").fetchone()
        if last and last[2] == source and last[3] == field:
            if last[4] == text:
                return
            if text.startswith(last[4]) and now - datetime.fromisoformat(last[1]).timestamp() <= COLLAPSE_SECONDS:
                self._db.execute(
                    "UPDATE scans SET ts=?, text=?, blocked=?, score=?, level=?, rules=?, ml_probability=?, "
                    "decode_layers=? WHERE id=?", values + (last[0],))
                return
        self._db.execute(
            "INSERT INTO scans (ts, source, field, text, blocked, score, level, rules, ml_probability, "
            "decode_layers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ts, source, field, text, *values[2:]))

    def page(self, filter: str = "all", limit: int = 25, offset: int = 0) -> dict:
        """{"items": rows newest first, "total": rows matching `filter`, "counts": {all, blocked, allowed}}."""
        if filter not in FILTERS:
            raise ValueError(f"filter must be one of {', '.join(FILTERS)}")
        where = {"all": "", "blocked": "WHERE blocked = 1", "allowed": "WHERE blocked = 0"}[filter]
        with self._lock:
            everything, blocked = self._db.execute("SELECT COUNT(*), COALESCE(SUM(blocked), 0) FROM scans").fetchone()
            records = self._db.execute(
                f"SELECT {_COLUMNS} FROM scans {where} ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        counts = {"all": everything, "blocked": blocked, "allowed": everything - blocked}
        return {"items": [_row(r) for r in records], "total": counts[filter], "counts": counts}

    def export_rows(self) -> list[dict]:
        with self._lock:
            records = self._db.execute(f"SELECT {_COLUMNS} FROM scans ORDER BY id DESC").fetchall()
        return [_row(r) for r in records]

    def rows_since(self, since: datetime | None) -> list[dict]:
        """Rows stored at or after `since` (None: every row), newest first. Stored `ts` strings are all UTC ISO with
        milliseconds, so comparing them as text is comparing them as times."""
        if since is None:
            return self.export_rows()
        cut = since.astimezone(timezone.utc).isoformat(timespec="milliseconds")
        with self._lock:
            records = self._db.execute(
                f"SELECT {_COLUMNS} FROM scans WHERE ts >= ? ORDER BY id DESC", (cut,)).fetchall()
        return [_row(r) for r in records]

    def clear(self) -> int:
        with self._lock, self._db:
            return self._db.execute("DELETE FROM scans").rowcount

    def close(self) -> None:
        with self._lock:
            if self._db is not None:
                self._db.close()
                self._db = None


def _cell(value: str) -> str:
    """A spreadsheet runs a cell that starts with = + - @ as a formula, and the text here may be an attack."""
    return "'" + value if value.startswith(_FORMULA_STARTS) else value


def to_csv(rows: list[dict]) -> str:
    """UTF-8 CSV text starting with a byte-order mark (so Excel reads it as UTF-8), header row first."""
    out = io.StringIO(newline="")
    out.write("﻿")
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        writer.writerow([
            r["id"], r["ts"], _cell(r["source"]), _cell(r["field"]), _cell(r["text"]),
            "true" if r["blocked"] else "false", r["score"], r["level"], " ".join(r["rules"]),
            "" if r["ml_probability"] is None else r["ml_probability"], r["decode_layers"]])
    return out.getvalue()
