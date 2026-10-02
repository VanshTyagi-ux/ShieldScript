import csv
import io
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path

from xss_detector.store import CSV_COLUMNS, MAX_TEXT, ScanStore, to_csv


class Clock:
    """A settable clock (epoch seconds), so the typing-collapse window can be tested without sleeping."""

    def __init__(self):
        self.now = 1_700_000_000.0

    def __call__(self):
        return self.now


def add(store, text, **over):
    fields = dict(source=None, field="text", blocked=False, score=0, level="safe", rules=[], ml_probability=None,
                  decode_layers=0)
    fields.update(over)
    store.add(text=text, **fields)


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "scans.db"
        self.clock = Clock()
        self.store = self.open()

    def open(self, **kwargs):
        store = ScanStore(self.path, clock=self.clock, **kwargs)
        self.addCleanup(store.close)  # runs before the temp directory is removed (cleanups are last-in first-out)
        return store

    def texts(self, store=None):
        return [row["text"] for row in (store or self.store).export_rows()]


class RowTests(StoreTestCase):
    def test_rows_come_back_newest_first_with_the_documented_shape(self):
        for i, text in enumerate(("alpha", "bravo", "charlie")):
            self.clock.now += 10
            add(self.store, text, blocked=(i == 2), score=95 if i == 2 else 0, rules=["XSS002"] if i == 2 else [])
        rows = self.store.page()["items"]
        self.assertEqual([r["text"] for r in rows], ["charlie", "bravo", "alpha"])
        self.assertEqual(set(rows[0]), set(CSV_COLUMNS))
        self.assertIs(rows[0]["blocked"], True)
        self.assertIs(rows[1]["blocked"], False)
        self.assertEqual(rows[0]["rules"], ["XSS002"])
        self.assertEqual(rows[0]["source"], "")
        self.assertTrue(rows[0]["ts"].endswith("+00:00"))

    def test_source_is_kept_when_given(self):
        add(self.store, "hello", source="dummy-site")
        self.assertEqual(self.store.page()["items"][0]["source"], "dummy-site")

    def test_filter_counts_and_unknown_filter(self):
        for i in range(5):
            self.clock.now += 10
            add(self.store, f"row {i:02d}", blocked=i < 2)
        self.assertEqual(self.store.page("blocked")["total"], 2)
        self.assertEqual(self.store.page("allowed")["total"], 3)
        self.assertEqual(self.store.page()["counts"], {"all": 5, "blocked": 2, "allowed": 3})
        with self.assertRaises(ValueError):
            self.store.page("bogus")

    def test_paging_and_offset_past_the_end(self):
        for i in range(30):
            self.clock.now += 10
            add(self.store, f"row {i:02d}")
        self.assertEqual(len(self.store.page(limit=25, offset=25)["items"]), 5)
        past = self.store.page(limit=25, offset=100)
        self.assertEqual(past["items"], [])
        self.assertEqual(past["total"], 30)

    def test_text_is_cut_to_1000_characters(self):
        add(self.store, "a" * MAX_TEXT)
        self.clock.now += 10
        add(self.store, "b" * (MAX_TEXT + 1))
        lengths = sorted(len(t) for t in self.texts())
        self.assertEqual(lengths, [1000, 1000])
        self.assertEqual(MAX_TEXT, 1000)

    def test_rows_since_returns_rows_at_or_after_the_cut_off_newest_first(self):
        stamps = []
        for text in ("alpha", "bravo", "charlie"):
            add(self.store, text)
            stamps.append(self.clock.now)
            self.clock.now += 10
        cut = datetime.fromtimestamp(stamps[1], timezone.utc)
        self.assertEqual([r["text"] for r in self.store.rows_since(cut)], ["charlie", "bravo"])
        self.assertEqual([r["text"] for r in self.store.rows_since(None)], ["charlie", "bravo", "alpha"])
        self.assertEqual(self.store.rows_since(datetime.fromtimestamp(stamps[2] + 1, timezone.utc)), [])

    def test_clear_returns_the_count_and_empties(self):
        for i in range(3):
            self.clock.now += 10
            add(self.store, f"row {i}")
        self.assertEqual(self.store.clear(), 3)
        self.assertEqual(self.store.page()["total"], 0)

    def test_rows_survive_reopening_the_file(self):
        add(self.store, "kept")
        self.store.close()
        reopened = self.open()
        self.assertEqual(self.texts(reopened), ["kept"])


class CollapseAndCapTests(StoreTestCase):
    def test_typing_collapse(self):
        add(self.store, "<im")
        self.clock.now += 2
        add(self.store, "<img")
        self.clock.now += 2.5  # 2.5 s after the replaced row, so still inside the window
        add(self.store, "<img s")
        self.assertEqual(self.texts(), ["<img s"])
        self.clock.now += 20
        add(self.store, "<img src")
        self.assertEqual(self.texts(), ["<img src", "<img s"])

    def test_identical_text_is_dropped_and_other_changes_add_a_row(self):
        add(self.store, "hello")
        add(self.store, "hello")
        self.assertEqual(self.texts(), ["hello"])
        add(self.store, "hello world", field="comment")  # a different field
        add(self.store, "hello world", source="blog", field="comment")  # a different source
        add(self.store, "unrelated text", source="blog", field="comment")  # not an extension
        self.assertEqual(len(self.texts()), 4)

    def test_row_cap_drops_the_oldest(self):
        store = self.open(max_rows=5)
        names = [f"item-{chr(97 + i)}" for i in range(8)]
        for name in names:
            self.clock.now += 10
            add(store, name)
        self.assertEqual(store.page()["total"], 5)
        self.assertEqual(self.texts(store), list(reversed(names[3:])))

    def test_add_many_adds_every_row_and_applies_the_cap_once(self):
        store = self.open(max_rows=3)
        batch = [dict(source=None, field=f"f{i}", text=f"value {i}", blocked=False, score=0, level="safe",
                      rules=[], ml_probability=None, decode_layers=0) for i in range(5)]
        store.add_many(batch)
        self.assertEqual(store.page()["total"], 3)
        self.assertEqual([r["field"] for r in store.export_rows()], ["f4", "f3", "f2"])

    def test_many_threads_can_add_at_once(self):
        errors = []

        def worker(i):
            try:
                for j in range(10):
                    add(self.store, f"{i:02d}-{j:02d}")
            except Exception as exc:  # noqa: BLE001 - any failure is the finding
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(self.store.page()["total"], 200)


class CsvTests(unittest.TestCase):
    def row(self, **over):
        row = dict(id=1, ts="2026-10-01T04:10:53.123+00:00", source="", field="text", text="hello", blocked=False,
                   score=0, level="safe", rules=[], ml_probability=None, decode_layers=0)
        row.update(over)
        return row

    def parse(self, text):
        return list(csv.reader(io.StringIO(text.lstrip("﻿"), newline="")))

    def test_to_csv_neutralises_formulas(self):
        for bad in ("=1+1", "+x", "-x", "@x", "\tx", "\rx"):
            with self.subTest(bad=bad):
                cells = self.parse(to_csv([self.row(source=bad, field=bad, text=bad)]))[1]
                self.assertTrue(cells[CSV_COLUMNS.index("text")].startswith("'"))
                self.assertTrue(cells[CSV_COLUMNS.index("source")].startswith("'"))
                self.assertTrue(cells[CSV_COLUMNS.index("field")].startswith("'"))
        plain = self.parse(to_csv([self.row(text="hello")]))[1]
        self.assertEqual(plain[CSV_COLUMNS.index("text")], "hello")

    def test_to_csv_round_trips_awkward_text(self):
        awkward = 'a,b "q"\nline2 é☃'
        out = to_csv([self.row(text=awkward, blocked=True, rules=["XSS002", "XSS033"])])
        self.assertTrue(out.startswith("﻿"))
        rows = self.parse(out)
        self.assertEqual(rows[0], CSV_COLUMNS)
        self.assertEqual(rows[1][CSV_COLUMNS.index("text")], awkward)
        self.assertEqual(rows[1][CSV_COLUMNS.index("rules")], "XSS002 XSS033")
        self.assertEqual(rows[1][CSV_COLUMNS.index("blocked")], "true")
        self.assertEqual(rows[1][CSV_COLUMNS.index("ml_probability")], "")


if __name__ == "__main__":
    unittest.main()
