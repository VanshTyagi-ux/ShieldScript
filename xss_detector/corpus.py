"""Datasets for training/benchmarking.

malicious : public payload lists in data/payloads/*.txt (SecLists, MIT licence),
            de-duplicated, one payload per line.
benign    : (a) English/code lines from Python's own documentation - realistic text
            with many `<`, `&`, quotes and parentheses; (b) synthetic form input
            (names, emails, addresses, URLs, comments).
hard      : hand-written tricky-but-harmless inputs. Used ONLY for evaluation,
            never for training, so they measure generalisation.

Every sample is assigned to train (70%) or test (30%) by a hash of its text, so
the split is deterministic and duplicates can never leak across it.
"""

from __future__ import annotations

import random
import re
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAYLOAD_DIR = ROOT / "data" / "payloads"

HARD_BENIGN = [
    "I <3 programming & coffee", "5 < 10 and 10 > 5", "if a < script_length then stop",
    "Please confirm your order (12345)", "I love JavaScript: The Good Parts",
    "The onclick event is commonly used in web pages.", "a = b + c", "100% sure, 50%25 off",
    "Tom & Jerry &amp; friends", "C:\\users\\public\\documents", "SELECT * FROM users WHERE id = 1",
    "O'Brien said \"hello\" to Zoe", "Price: $5 < $10 > $2", "x => x * 2", "a && b || c",
    "Use the <b>bold</b> tag for emphasis", "Line one\nLine two\twith tab",
    "Please alert me when the order ships", "What's your prompt (question) for the interview?",
    "Meeting at 3pm - bring the docs (and coffee)", "email: first.last+tag@example.co.uk",
    "https://example.com/search?q=cats&page=2#results", "www.example.com/path/to/page.html",
    "Café résumé naïve 日本語 Привет мир", "🙂 great product, 5/5 would buy again",
    "The document was written in 2019 and revised in 2021", "onset = 3 days after symptoms",
    "Call me on +1 (555) 010-9999 after 5", "Dear Sir/Madam, I am writing to complain...",
    "1 + 1 = 2; 2 * 3 = 6", "{name: 'Ada', age: 36}", "def add(a, b): return a + b",
    "The location of the store is on Main Street", "fetch the report from the server tomorrow",
    "Use eval sparingly", "The set of all sets is not a set", "I saw a script for a movie",
    "Book 1: Style guide for links and forms", "Templates are useful: {{ name }} is replaced",
    "a<b and c>d", "<3 <3 <3", "5 < 10", "a < b", "Tom & Jerry", "x > y", "Q&A", "R&D <team>", "-- comment here", "/* not code */ just a note",
]

_FIRST = ["Ada", "Grace", "Linus", "Priya", "Wei", "Fatima", "Carlos", "Olga", "Kofi", "Yuki", "Sean", "Zoe"]
_LAST = ["Lovelace", "Hopper", "Torvalds", "Sharma", "Chen", "Khan", "Garcia", "Ivanova", "Mensah", "Tanaka", "O'Brien", "Smith-Jones"]
_STREET = ["Main St", "Park Avenue", "Oak Road", "MG Road", "Elm Street", "5th Ave", "High Street"]
_CITY = ["Delhi", "Boston", "London", "Berlin", "Lagos", "Tokyo", "Toronto", "Sydney"]
_DOMAIN = ["example.com", "mail.org", "corp.example.co.uk", "university.edu", "shop.io"]
_COMMENT = [
    "Great article, thanks for sharing! I learned a lot.", "I disagree with point #3, but well written.",
    "Can you add more examples? (especially for beginners)", "Order #{n} arrived late & damaged - please refund.",
    "Loved it :) 10/10 would recommend to friends & family", "How do I reset my password? It says \"invalid token\".",
    "The price is $ {n} < the competitor's $ {m}.", "Working hours: Mon-Fri, 9:00 - 17:30 (IST)",
    "Update: the bug is fixed in v{n}.{m}, see notes.", "Anyone else seeing 404 errors on /api/v{n}/items?",
]


def _bucket(text: str) -> int:
    return zlib.crc32(text.encode("utf-8", "replace")) % 10


def split_of(text: str) -> str:
    return "train" if _bucket(text) < 7 else "test"


def load_malicious_by_source() -> dict[str, list[str]]:
    """{file name: payloads}; a payload appearing in several files is kept in the first only."""
    seen, out = set(), {}
    for path in sorted(PAYLOAD_DIR.glob("*.txt")):
        items = []
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if len(line) >= 3 and line not in seen:
                seen.add(line)
                items.append(line)
        out[path.name] = items
    return out


def load_malicious() -> list[str]:
    return [p for items in load_malicious_by_source().values() for p in items]


def _doc_lines(limit: int, seed: int) -> list[str]:
    from pydoc_data import topics

    lines = []
    for text in topics.topics.values():
        for line in text.splitlines():
            line = re.sub(r"\s+", " ", line).strip()
            if 4 <= len(line) <= 200 and re.search(r"[A-Za-z]{3}", line):
                lines.append(line)
    lines = sorted(set(lines))
    random.Random(seed).shuffle(lines)
    return lines[:limit]


def _form_inputs(count: int, seed: int) -> list[str]:
    rng = random.Random(seed)
    out = []
    for _ in range(count):
        first, last = rng.choice(_FIRST), rng.choice(_LAST)
        kind = rng.randrange(6)
        if kind == 0:
            out.append(f"{first} {last}")
        elif kind == 1:
            out.append(f"{first}.{last}{rng.randrange(100)}@{rng.choice(_DOMAIN)}".lower().replace("'", ""))
        elif kind == 2:
            out.append(f"{rng.randrange(1, 999)} {rng.choice(_STREET)}, {rng.choice(_CITY)} {rng.randrange(10000, 99999)}")
        elif kind == 3:
            out.append(f"https://{rng.choice(_DOMAIN)}/{first.lower()}/{rng.randrange(1000)}?ref={last.lower()}&lang=en")
        elif kind == 4:
            out.append(f"+{rng.randrange(1, 99)} {rng.randrange(100, 999)}-{rng.randrange(100, 999)}-{rng.randrange(1000, 9999)}")
        else:
            out.append(rng.choice(_COMMENT).format(n=rng.randrange(1, 999), m=rng.randrange(1, 99)))
    return sorted(set(out))


def load_benign(doc_limit: int = 12000, form_count: int = 13020, seed: int = 7) -> list[str]:
    hard = set(HARD_BENIGN)
    return [t for t in _doc_lines(doc_limit, seed) + _form_inputs(form_count, seed) if t not in hard]


def load_dataset() -> dict:
    """{'malicious': {'train': [...], 'test': [...]}, 'benign': {...}, 'hard': [...]}"""
    def split(items):
        parts = {"train": [], "test": []}
        for item in items:
            parts[split_of(item)].append(item)
        return parts

    return {"malicious": split(load_malicious()), "benign": split(load_benign()), "hard": list(HARD_BENIGN)}
