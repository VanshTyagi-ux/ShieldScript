import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from xss_detector import evaluate
from xss_detector.evaluate import SHIPPED, Metrics, build_report_data


def make_results():
    long_items = [f"payload-{i}-" + "x" * 300 for i in range(30)]
    return [
        {"name": SHIPPED, "metrics": Metrics(tp=8, fn=2, fp=1, tn=9),
         "misses": long_items, "false_pos": ["a"] * 30, "hard_fp": ["h" * 300] * 60},
        {"name": "Rules", "metrics": Metrics(tp=5, fn=5, fp=0, tn=10), "misses": ["m"], "false_pos": [], "hard_fp": []},
    ]


DATA = {"malicious": {"test": list(range(10))}, "benign": {"test": list(range(10))}, "hard": list(range(4))}
CROSS = [
    {"source": "a.txt", "n": 100, "rules": 0.5, "ml": 1.0, "ml_fpr": 0.0},
    {"source": "b.txt", "n": 300, "rules": 1.0, "ml": 0.5, "ml_fpr": 0.001},
]


class BuildReportDataTests(unittest.TestCase):
    def test_schema_and_dataset_counts(self):
        report = build_report_data(make_results(), DATA, CROSS, today=date(2026, 9, 28))
        self.assertEqual(set(report), {"generated", "dataset", "detectors", "unseen_sources", "unseen_weighted", "notes"})
        self.assertEqual(report["dataset"], {"malicious_test": 10, "benign_test": 10, "hard_negatives": 4})
        self.assertEqual([d["name"] for d in report["detectors"]], [SHIPPED, "Rules"])

    def test_generated_date(self):
        self.assertEqual(build_report_data(make_results(), DATA, None, today=date(2026, 9, 28))["generated"], "2026-09-28")

    def test_detector_metrics_are_fractions_matching_Metrics(self):
        d = build_report_data(make_results(), DATA, None)["detectors"][0]
        self.assertAlmostEqual(d["recall"], 0.8)
        self.assertAlmostEqual(d["precision"], 8 / 9)
        self.assertAlmostEqual(d["fpr"], 0.1)
        self.assertAlmostEqual(d["f1"], 2 * (8 / 9) * 0.8 / ((8 / 9) + 0.8))
        self.assertAlmostEqual(d["accuracy"], 17 / 20)
        self.assertEqual((d["tp"], d["fn"], d["fp"], d["tn"]), (8, 2, 1, 9))
        self.assertEqual((d["hard_fps"], d["hard_total"]), (60, 4))

    def test_only_the_shipped_detector_is_flagged(self):
        flags = {d["name"]: d["shipped"] for d in build_report_data(make_results(), DATA, None)["detectors"]}
        self.assertEqual(flags, {SHIPPED: True, "Rules": False})

    def test_samples_are_truncated(self):
        samples = build_report_data(make_results(), DATA, None)["detectors"][0]["samples"]
        self.assertEqual(len(samples["misses"]), 12)
        self.assertTrue(all(len(s) <= 110 for s in samples["misses"]))
        self.assertEqual(len(samples["false_positives"]), 12)
        self.assertEqual(len(samples["hard_false_positives"]), 40)
        self.assertTrue(all(len(s) <= 110 for s in samples["hard_false_positives"]))

    def test_unseen_weighted_average(self):
        report = build_report_data(make_results(), DATA, CROSS)
        self.assertEqual(report["unseen_sources"][0], {"source": "a.txt", "payloads": 100, "rules_recall": 0.5, "ml_recall": 1.0, "ml_fpr": 0.0})
        weighted = report["unseen_weighted"]
        self.assertEqual(weighted["payloads"], 400)
        self.assertAlmostEqual(weighted["rules_recall"], 0.875)
        self.assertAlmostEqual(weighted["ml_recall"], 0.625)

    def test_no_cross_rows(self):
        report = build_report_data(make_results(), DATA, None)
        self.assertEqual(report["unseen_sources"], [])
        self.assertIsNone(report["unseen_weighted"])

    def test_notes_included(self):
        notes = build_report_data(make_results(), DATA, None)["notes"]
        self.assertEqual(len(notes), 3)
        self.assertTrue(all(isinstance(n, str) and n for n in notes))

    def test_markdown_report_renders_the_same_notes(self):
        md = evaluate.render_report(make_results(), DATA)
        for note in evaluate.NOTES:
            self.assertIn(f"> - {note}", md)


class MainWritesJsonTests(unittest.TestCase):
    def test_main_writes_markdown_and_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "b.md"
            evaluate.main(retrain=False, out=out, cross=False)
            self.assertTrue(out.exists())
            report = json.loads(out.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(len(report["detectors"]), 4)
            self.assertEqual(report["unseen_sources"], [])
            self.assertEqual(sum(d["shipped"] for d in report["detectors"]), 1)


if __name__ == "__main__":
    unittest.main()
