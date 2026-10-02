"""Turn stored scan rows into the summary the dashboard draws (GET /api/analytics). Pure: no I/O, no clock reads.

Everything is UTC. A range is a run of equal buckets that ends with the bucket containing `now`; every bucket is
present in the timeline, with zeros where nothing happened.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

RANGES = ("1h", "24h", "7d", "all")
MAX_ALL_DAYS = 60  # the "all" timeline shows at most this many of the most recent days
TOP_RULES = 10
TOP_GROUPS = 8  # sources and fields
RECENT_CRITICAL = 5
RECENT_TEXT = 120
LEVELS = ("safe", "low", "medium", "high", "critical")
NO_SOURCE = "(none)"
SCORE_BANDS = [f"{low}-{low + 9}" for low in range(0, 90, 10)] + ["90-100"]
# range -> (bucket name, bucket length, number of buckets)
_BUCKETS = {"1h": ("5min", timedelta(minutes=5), 12), "24h": ("hour", timedelta(hours=1), 24),
            "7d": ("day", timedelta(days=1), 7)}
_DAY = timedelta(days=1)


def _floor(moment: datetime, step: timedelta) -> datetime:
    """`moment` rounded down to a multiple of `step` since the epoch, which is aligned to UTC midnight."""
    seconds = int(step.total_seconds())
    stamp = int(moment.timestamp())
    return datetime.fromtimestamp(stamp - stamp % seconds, timezone.utc)


def window_start(range_key: str, now: datetime) -> datetime | None:
    """The start of the first bucket of `range_key` (None for "all": every stored row)."""
    if range_key not in RANGES:
        raise ValueError(f"range must be one of {', '.join(RANGES)}")
    if range_key == "all":
        return None
    _, step, count = _BUCKETS[range_key]
    return _floor(now.astimezone(timezone.utc), step) - (count - 1) * step


def _ranked(counter: Counter, limit: int | None = None) -> list[tuple[str, int]]:
    """Counter items by count (descending), ties by name."""
    items = sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    return items[:limit] if limit else items


def summarize(rows: list[dict], *, range_key: str, now: datetime, rules: list[dict], block_threshold: int) -> dict:
    """The dashboard summary of `rows` (store rows, any order) for `range_key` as seen at `now`. `rules` are the
    rule catalog rows ({id, name, category, ...}); `block_threshold` is the detector's block score."""
    now = now.astimezone(timezone.utc)
    start = window_start(range_key, now)
    catalog = {rule["id"]: rule for rule in rules}

    seen = []  # (time, row) for the rows inside the range
    for stored in rows:
        moment = datetime.fromisoformat(stored["ts"])
        if start is None or moment >= start:
            seen.append((moment, stored))

    if range_key == "all":
        bucket, step = "day", _DAY
        today = _floor(now, _DAY)
        oldest = min((moment for moment, _ in seen), default=today)
        first = max(_floor(oldest, _DAY), today - (MAX_ALL_DAYS - 1) * _DAY)
        count = (today - first) // _DAY + 1
    else:
        bucket, step, count = _BUCKETS[range_key]
        first = start
    timeline = [{"blocked": 0, "allowed": 0} for _ in range(count)]

    levels = {level: 0 for level in LEVELS}
    scores = [0] * len(SCORE_BANDS)
    rule_counts, category_counts = Counter(), Counter()
    source_scans, source_blocked, field_scans, field_blocked = Counter(), Counter(), Counter(), Counter()
    blocked_total = critical = escalations = 0

    for moment, stored in seen:
        blocked = bool(stored["blocked"])
        blocked_total += blocked
        index = (moment - first) // step
        if index >= 0:  # the "all" timeline leaves out days older than its 60-day window
            timeline[min(index, count - 1)]["blocked" if blocked else "allowed"] += 1
        if stored["level"] in levels:
            levels[stored["level"]] += 1
        critical += stored["level"] == "critical"
        escalations += blocked and stored["score"] < block_threshold
        scores[min(max(stored["score"], 0) // 10, len(scores) - 1)] += 1
        fired = set(stored["rules"])
        rule_counts.update(fired)
        category_counts.update({catalog[r]["category"] if r in catalog else "other" for r in fired})
        source = stored["source"] or NO_SOURCE
        source_scans[source] += 1
        field_scans[stored["field"]] += 1
        if blocked:
            source_blocked[source] += 1
            field_blocked[stored["field"]] += 1

    total = len(seen)
    timeline = [{"t": (first + i * step).isoformat(), **entry} for i, entry in enumerate(timeline)]
    newest_critical = sorted((s for s in seen if s[1]["level"] == "critical"), key=lambda s: s[0], reverse=True)

    return {
        "enabled": True,
        "range": range_key,
        "generated": now.replace(microsecond=0).isoformat(),
        "bucket": bucket,
        "totals": {"scans": total, "blocked": blocked_total, "allowed": total - blocked_total,
                   "block_rate": blocked_total / total if total else 0, "critical": critical,
                   "ml_escalations": escalations},
        "timeline": timeline,
        "levels": levels,
        "rules": [{"rule_id": rule_id, "name": catalog.get(rule_id, {}).get("name", rule_id),
                   "category": catalog.get(rule_id, {}).get("category", "other"), "count": n}
                  for rule_id, n in sorted(rule_counts.items(), key=lambda item: (
                      -item[1], catalog.get(item[0], {}).get("name", item[0])))[:TOP_RULES]],
        "categories": [{"category": name, "count": n} for name, n in _ranked(category_counts)],
        "sources": [{"source": name, "scans": n, "blocked": source_blocked[name]}
                    for name, n in _ranked(source_scans, TOP_GROUPS)],
        "fields": [{"field": name, "scans": n, "blocked": field_blocked[name]}
                   for name, n in _ranked(field_scans, TOP_GROUPS)],
        "scores": [{"label": label, "count": n} for label, n in zip(SCORE_BANDS, scores)],
        "recent_critical": [{"ts": moment.isoformat(timespec="milliseconds"), "source": stored["source"],
                             "field": stored["field"], "score": stored["score"], "rules": stored["rules"],
                             "text": stored["text"][:RECENT_TEXT]}
                            for moment, stored in newest_critical[:RECENT_CRITICAL]],
    }
