"""Seed the database with the payload lists in data/payloads/*.txt.

Run from backend/:
    python -m scripts.seed_payloads              # add anything not stored yet (safe to re-run)
    python -m scripts.seed_payloads --replace    # reload these files from scratch (e.g. after recategorising)
    python -m scripts.seed_payloads --dir PATH   # read a different folder of .txt files

What it does:
  1. scans <repo>/data/payloads/*.txt (that is ../data/payloads from backend/, wherever you run it from);
  2. reads each file line by line, strips whitespace, skips blank lines;
  3. de-duplicates: a payload is kept once, under the first file (by name) that contains it;
  4. tags each file with a category inferred from its name (app.services.payloads.infer_category);
  5. bulk-inserts the rows into the Payload table;
  6. logs how many records each file contributed.

The database is whatever DATABASE_URL (.env) points at; missing tables are created first.
"""

import argparse
import logging
import sys
from pathlib import Path

from app.core.database import Base, SessionLocal, engine
from app.core.repo import PAYLOAD_DIR

import app.models  # noqa: F401  (registers the tables on Base.metadata)
from app.services.payloads import collect_payloads, infer_category, load_payloads

log = logging.getLogger("seed_payloads")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed the payloads table from data/payloads/*.txt")
    parser.add_argument("--dir", type=Path, default=PAYLOAD_DIR, help=f"folder of .txt files (default: {PAYLOAD_DIR})")
    parser.add_argument("--replace", action="store_true", help="delete the rows of these files first, then reload")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)

    if not args.dir.is_dir() or not any(args.dir.glob("*.txt")):
        log.error("error: no .txt payload files in %s", args.dir)
        return 2

    log.info("Scanning %s", args.dir)
    found = collect_payloads(args.dir)

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        stats = load_payloads(db, found.sources, replace=args.replace)

    for name in found.sources:
        log.info("%-52s %-9s ingested %5d   (lines %5d, blank %d, duplicate %d)",
                 name, infer_category(name), stats.per_file.get(name, 0),
                 found.lines[name], found.blank[name], found.duplicates[name])
    log.info("Ingested %d records from %d files (already stored: %d, invalid: %d, deleted first: %d)",
             stats.inserted, len(found.sources), stats.skipped_existing, stats.skipped_invalid, stats.deleted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
