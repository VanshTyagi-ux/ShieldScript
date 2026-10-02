import random
import unittest
from datetime import datetime, timedelta, timezone

from xss_detector.analytics import RANGES, summarize, window_start

NOW = datetime(2026, 10, 1, 12, 34, 56, tzinfo=timezone.utc)
RULES = [
    {"id": "XSS001", "name": "Script tag", "category": "markup"},
    {"id": "XSS002", "name": "Inline event handler (known)", "category": "markup"},
    {"id": "XSS030", "name": "Cookie / storage access", "category": "javascript"},
    {"id": "XSS099", "name": "Encoded / obfuscated payload", "category": "evasion"},
]
LEVELS = ["safe", "low", "medium", "high", "critical"]


def row(ts, **over):
    fields = dict(id=1, source="blog", field="comment", text="x", blocked=False, score=0, level="safe", rules=[],
                  ml_probability=None, decode_layers=0)
    fields.update(over)
    return dict(fields, ts=ts.isoformat(timespec="milliseconds"))


def summary(rows, range_key="24h", **over):
    return summarize(rows, range_key=range_key, now=NOW, rules=RULES, block_threshold=25, **over)


def minutes_ago(n):
    return NOW - timedelta(minutes=n)


class WindowTests(unittest.TestCase):
    def test_window_start_per_range(self):
        self.assertEqual(window_start("1h", NOW).isoformat(), "2026-10-01T11:35:00+00:00")
        self.assertEqual(window_start("24h", NOW).isoformat(), "2026-09-30T13:00:00+00:00")
        self.assertEqual(window_start("7d", NOW).isoformat(), "2026-09-25T00:00:00+00:00")
        self.assertIsNone(window_start("all", NOW))
        self.assertEqual(RANGES, ("1h", "24h", "7d", "all"))
        with self.assertRaises(ValueError):
            window_start("2h", NOW)

    def test_timeline_has_every_bucket_zero_filled_and_the_right_size(self):
        for key, size, bucket, last in (("1h", 12, "5min", "2026-10-01T12:30:00"), ("24h", 24, "hour", "2026-10-01T12:00:00"),
                                        ("7d", 7, "day", "2026-10-01T00:00:00")):
            with self.subTest(range=key):
                result = summary([], key)
                self.assertEqual(len(result["timeline"]), size)
                self.assertEqual(result["bucket"], bucket)
                self.assertTrue(result["timeline"][-1]["t"].startswith(last))
                self.assertTrue(all(b["blocked"] == 0 and b["allowed"] == 0 for b in result["timeline"]))

    def test_all_range_spans_from_the_oldest_row_up_to_60_days(self):
        result = summary([row(NOW - timedelta(days=3))], "all")
        self.assertEqual(len(result["timeline"]), 4)
        result = summary([row(NOW - timedelta(days=100)), row(NOW - timedelta(days=1))], "all")
        self.assertEqual(len(result["timeline"]), 60)
        self.assertEqual(result["totals"]["scans"], 2)  # the older row still counts in the totals
        self.assertEqual(result["bucket"], "day")

    def test_boundaries(self):
        at_now_bucket = datetime(2026, 10, 1, 12, 30, 0, tzinfo=timezone.utc)
        window_first = datetime(2026, 10, 1, 11, 35, 0, tzinfo=timezone.utc)
        before = window_first - timedelta(milliseconds=1)
        future = datetime(2026, 10, 1, 12, 50, 0, tzinfo=timezone.utc)
        result = summary([row(at_now_bucket), row(window_first, blocked=True), row(before), row(future)], "1h")
        timeline = result["timeline"]
        self.assertEqual(result["totals"]["scans"], 3)  # the row before the window is ignored everywhere
        self.assertEqual((timeline[0]["blocked"], timeline[0]["allowed"]), (1, 0))
        self.assertEqual((timeline[-1]["blocked"], timeline[-1]["allowed"]), (0, 2))  # the 12:30 row and the future row
        self.assertEqual(sum(b["blocked"] + b["allowed"] for b in timeline), 3)


class TotalsTests(unittest.TestCase):
    def test_totals_and_block_rate(self):
        rows = [row(minutes_ago(i), blocked=i < 3, level="critical" if i == 0 else "safe") for i in range(4)]
        totals = summary(rows)["totals"]
        self.assertEqual((totals["scans"], totals["blocked"], totals["allowed"], totals["block_rate"]), (4, 3, 1, 0.75))
        self.assertEqual(totals["critical"], 1)

    def test_no_rows_is_all_zeros_and_a_zero_block_rate(self):
        totals = summary([])["totals"]
        self.assertEqual(totals, {"scans": 0, "blocked": 0, "allowed": 0, "block_rate": 0, "critical": 0, "ml_escalations": 0})

    def test_ml_escalations_are_blocked_scans_below_the_threshold(self):
        rows = [row(minutes_ago(1), blocked=True, score=10), row(minutes_ago(2), blocked=True, score=30),
                row(minutes_ago(3), blocked=False, score=10)]
        self.assertEqual(summary(rows)["totals"]["ml_escalations"], 1)


class BreakdownTests(unittest.TestCase):
    def test_rule_counts_once_per_scan_and_use_catalog_names(self):
        rows = [row(minutes_ago(1), rules=["XSS002", "XSS002", "XSS030"]), row(minutes_ago(2), rules=["XSS002"])]
        by_id = {r["rule_id"]: r for r in summary(rows)["rules"]}
        self.assertEqual(by_id["XSS002"], {"rule_id": "XSS002", "name": "Inline event handler (known)",
                                           "category": "markup", "count": 2})
        self.assertEqual(by_id["XSS030"]["count"], 1)
        self.assertEqual([r["rule_id"] for r in summary(rows)["rules"]], ["XSS002", "XSS030"])

    def test_rules_are_sorted_and_cut_to_ten(self):
        catalog = [{"id": f"R{i:02d}", "name": f"Rule {i:02d}", "category": "markup"} for i in range(12)]
        rows = [row(minutes_ago(1), rules=[r["id"] for r in catalog])]
        result = summarize(rows, range_key="24h", now=NOW, rules=catalog, block_threshold=25)
        self.assertEqual(len(result["rules"]), 10)
        self.assertEqual([r["name"] for r in result["rules"]], [f"Rule {i:02d}" for i in range(10)])  # ties by name

    def test_unknown_rule_ids_do_not_crash(self):
        result = summary([row(minutes_ago(1), rules=["XSS777"])])
        self.assertEqual((result["rules"][0]["name"], result["rules"][0]["category"]), ("XSS777", "other"))
        self.assertEqual(result["categories"], [{"category": "other", "count": 1}])

    def test_categories_count_scans_with_at_least_one_rule_in_them(self):
        rows = [row(minutes_ago(1), rules=["XSS001", "XSS002"]), row(minutes_ago(2), rules=["XSS030"]),
                row(minutes_ago(3), rules=["XSS001"])]
        self.assertEqual(summary(rows)["categories"], [{"category": "markup", "count": 2}, {"category": "javascript", "count": 1}])

    def test_sources_and_fields_group_sort_and_cut(self):
        rows = [row(minutes_ago(1), source="", blocked=True), row(minutes_ago(2), source="", blocked=False),
                row(minutes_ago(3), source="blog", blocked=True)]
        rows += [row(minutes_ago(4 + i), source=f"app-{i}", field=f"f{i}") for i in range(8)]
        result = summary(rows)
        self.assertEqual(result["sources"][0], {"source": "(none)", "scans": 2, "blocked": 1})
        self.assertEqual(len(result["sources"]), 8)
        self.assertEqual(result["sources"][1]["source"], "app-0")  # ties by name, so "app-0" before "blog"
        self.assertEqual(len(result["fields"]), 8)
        self.assertEqual(result["fields"][0], {"field": "comment", "scans": 3, "blocked": 2})

    def test_levels_always_has_all_five_keys(self):
        self.assertEqual(summary([])["levels"], {k: 0 for k in LEVELS})
        levels = summary([row(minutes_ago(1), level="high"), row(minutes_ago(2), level="high")])["levels"]
        self.assertEqual((levels["high"], list(levels)), (2, LEVELS))

    def test_score_bands(self):
        scores = {0: "0-9", 9: "0-9", 10: "10-19", 89: "80-89", 90: "90-100", 100: "90-100"}
        for score, label in scores.items():
            with self.subTest(score=score):
                bands = summary([row(minutes_ago(1), score=score)])["scores"]
                self.assertEqual(len(bands), 10)
                self.assertEqual([b["label"] for b in bands][0], "0-9")
                self.assertEqual({b["label"]: b["count"] for b in bands}[label], 1)
                self.assertEqual(sum(b["count"] for b in bands), 1)

    def test_recent_critical_is_newest_first_limited_and_cut(self):
        rows = [row(minutes_ago(i), level="critical", text="a" * 300 if i == 1 else f"attack {i}", rules=["XSS001"], score=100)
                for i in range(1, 8)]
        rows += [row(minutes_ago(0), level="high")]
        recent = summary(rows)["recent_critical"]
        self.assertEqual(len(recent), 5)
        self.assertEqual(len(recent[0]["text"]), 120)  # the newest critical row is the 300-character one
        self.assertEqual([r["ts"][11:16] for r in recent], ["12:33", "12:32", "12:31", "12:30", "12:29"])
        self.assertEqual(set(recent[0]), {"ts", "source", "field", "score", "rules", "text"})

    def test_input_order_does_not_matter(self):
        rows = [row(minutes_ago(i), blocked=i % 2 == 0, score=i * 7 % 100, level=LEVELS[i % 5], rules=["XSS001", "XSS030"][: i % 3],
                    source=["", "blog", "api"][i % 3]) for i in range(40)]
        shuffled = rows[:]
        random.Random(3).shuffle(shuffled)
        self.assertEqual(summary(shuffled), summary(rows))

    def test_the_result_has_the_documented_keys(self):
        result = summary([row(minutes_ago(1))])
        self.assertEqual(set(result), {"enabled", "range", "generated", "bucket", "totals", "timeline", "levels", "rules",
                                       "categories", "sources", "fields", "scores", "recent_critical"})
        self.assertTrue(result["enabled"])
        self.assertEqual((result["range"], result["generated"]), ("24h", "2026-10-01T12:34:56+00:00"))


if __name__ == "__main__":
    unittest.main()
