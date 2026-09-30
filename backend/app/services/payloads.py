"""Reading payload files, storing them in the database, and querying them back."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from itertools import islice
from pathlib import Path
from typing import Callable, Iterable, Mapping

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.models.payload import Payload
from app.schemas.payload import PayloadFilter

DEFAULT_CATEGORY = "standard"
BATCH_SIZE = 1000

# The category comes from the file name: its words are matched against these, first hit wins. Tokens are whole
# words (so "legend" does not match "ende"): "XSS-EnDe-mario.txt" -> {xss, ende, mario} -> encoded.
_CATEGORY_WORDS: tuple[tuple[str, frozenset[str]], ...] = (
    ("polyglot", frozenset({"polyglot", "polyglots"})),  # one string that fires in many contexts
    ("encoded", frozenset({"ende", "encode", "encoded", "encoding"})),  # relies on encode/decode differences
    ("bypass", frozenset({"bypass", "bypasses", "evasion", "waf", "without"})),  # filter / WAF evasion tricks
)
# Files whose name says nothing about what they hold. Everything else is inferred from its name.
CATEGORY_OVERRIDES: dict[str, str] = {
    "XSS-innerht-ml.txt": "polyglot",  # innerht.ml polyglots
    "XSS-RSNAKE.txt": "bypass",  # RSnake's filter-evasion cheat sheet
    "XSS-Somdev.txt": "bypass",  # obfuscated, mixed-case, encoded-escape vectors
}


def infer_category(filename: str) -> str:
    """polyglot / encoded / bypass if the file name says so, else "standard"."""
    if filename in CATEGORY_OVERRIDES:
        return CATEGORY_OVERRIDES[filename]
    words = set(re.findall(r"[a-z0-9]+", Path(filename).stem.lower()))
    for category, keywords in _CATEGORY_WORDS:
        if words & keywords:
            return category
    return DEFAULT_CATEGORY


# -- reading files ------------------------------------------------------------------------------------------
@dataclass
class Collected:
    sources: dict[str, list[str]] = field(default_factory=dict)  # file name -> its new, unique payloads
    lines: dict[str, int] = field(default_factory=dict)  # file name -> non-blank lines read
    blank: dict[str, int] = field(default_factory=dict)  # file name -> blank lines skipped
    duplicates: dict[str, int] = field(default_factory=dict)  # file name -> lines seen before (this file or earlier)


def collect_payloads(directory: Path) -> Collected:
    """Read every *.txt in `directory` (sorted by name), one payload per line.

    Each line is stripped; blank lines are skipped. A payload is kept once, under the first file that has it,
    so `sources` never repeats a payload and each row keeps the file it was found in. Files are read
    line by line, never loaded whole; undecodable bytes become U+FFFD instead of failing the run.
    """
    out, seen = Collected(), set()
    for path in sorted(directory.glob("*.txt")):
        name, unique = path.name, []
        out.lines[name] = out.blank[name] = out.duplicates[name] = 0
        with path.open(encoding="utf-8-sig", errors="replace") as fh:  # utf-8-sig drops a leading BOM
            for raw in fh:
                line = raw.strip()
                if not line:
                    out.blank[name] += 1
                    continue
                out.lines[name] += 1
                if line in seen:
                    out.duplicates[name] += 1
                else:
                    seen.add(line)
                    unique.append(line)
        out.sources[name] = unique
    return out


# -- storing ------------------------------------------------------------------------------------------------
@dataclass
class LoadStats:
    inserted: int = 0
    skipped_existing: int = 0  # already in the table (same source_file and content)
    skipped_invalid: int = 0  # contains a NUL character, which PostgreSQL cannot store in text
    deleted: int = 0  # rows removed first because of replace=True
    per_file: dict[str, int] = field(default_factory=dict)  # file -> rows inserted


def _batches(rows: Iterable[dict], size: int):
    it = iter(rows)
    while chunk := list(islice(it, size)):
        yield chunk


def load_payloads(
    db: Session,
    sources: Mapping[str, Iterable[str]],
    *,
    replace: bool = False,
    category_for: Callable[[str], str] = infer_category,
) -> LoadStats:
    """Bulk-insert `sources` ({file name: payload strings}) into the payloads table and commit.

    Rows go in through SQLAlchemy's bulk insert (one executemany per BATCH_SIZE rows). Safe to run repeatedly:
    a payload already stored for the same file is skipped, so a second run inserts nothing. With replace=True
    the rows of the files being loaded are deleted first, which is how a changed category takes effect. Rows
    from files not in `sources` are never touched. All or nothing: a failure rolls everything back.
    """
    stats = LoadStats()
    names = list(sources)

    if replace:
        stats.deleted = db.execute(delete(Payload).where(Payload.source_file.in_(names))).rowcount or 0
        existing: set[tuple[str, str]] = set()
    else:
        rows = db.execute(select(Payload.source_file, Payload.content).where(Payload.source_file.in_(names)))
        existing = {(source, content) for source, content in rows}

    def new_rows():
        for name in names:
            category = category_for(name)
            for content in sources[name]:
                if "\x00" in content:
                    stats.skipped_invalid += 1
                elif (name, content) in existing:
                    stats.skipped_existing += 1
                else:
                    existing.add((name, content))  # also drops duplicates within the input itself
                    stats.per_file[name] = stats.per_file.get(name, 0) + 1
                    yield {"content": content, "source_file": name, "category": category}

    try:
        for chunk in _batches(new_rows(), BATCH_SIZE):
            db.execute(insert(Payload), chunk)
            stats.inserted += len(chunk)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return stats


# -- querying -----------------------------------------------------------------------------------------------
def get_payload(db: Session, payload_id: int) -> Payload | None:
    return db.get(Payload, payload_id)


def payload_facets(db: Session) -> dict:
    """Counts per category and per source file, largest first (ties by name), and the overall total."""
    def counts(column):
        rows = db.execute(select(column, func.count()).group_by(column).order_by(func.count().desc(), column))
        return [{"name": name, "count": count} for name, count in rows]

    categories = counts(Payload.category)
    return {"total": sum(c["count"] for c in categories), "categories": categories,
            "sources": counts(Payload.source_file)}


def list_payloads(db: Session, filters: PayloadFilter) -> tuple[list[Payload], int]:
    """(one page of payloads in id order, total number matching the filters)."""
    conditions = []
    if filters.source_file is not None:
        conditions.append(Payload.source_file == filters.source_file)
    if filters.category is not None:
        conditions.append(Payload.category == filters.category)

    total = db.scalar(select(func.count()).select_from(Payload).where(*conditions)) or 0
    rows = db.scalars(select(Payload).where(*conditions).order_by(Payload.id)
                      .offset(filters.skip).limit(filters.limit)).all()
    return list(rows), total
