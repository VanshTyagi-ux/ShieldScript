"""Guards against a catastrophic-regex regression: one scan of a maximum-size hostile input must stay fast.

Measured when this was written (256 KB, one scan): 0.06-0.17 s. The budget is generous on purpose so the test
catches an algorithmic blow-up, not a slow machine. Override with SCAN_BUDGET_SECONDS to tighten it."""

import json
import os
import time
import unittest
import urllib.parse

from tests.helpers import ServerTestCase, call
from xss_detector.config import Config
from xss_detector.ml import HybridDetector

BUDGET = float(os.environ.get("SCAN_BUDGET_SECONDS", "2.0"))
SIZE = 256 * 1024


def repeat(unit: str, size: int = SIZE) -> str:
    return (unit * (size // len(unit) + 1))[:size]


def layered(text: str, layers: int) -> str:
    for _ in range(layers):
        text = urllib.parse.quote(text)
    return text


CASES = {
    "run of <": repeat("<"),
    "<a repeated": repeat("<a "),
    "<script repeated": repeat("<script"),
    "onerror= repeated": "<img " + repeat("onerror=", SIZE - 5),
    "quote run": repeat('"'),
    "javascript: repeated": repeat("javascript:"),
    "%25 repeated": repeat("%25"),
    "&amp; repeated": repeat("&amp;"),
    "\\u003c repeated": repeat("\\u003c"),
    "spaces": repeat(" "),
    "onload words": repeat("onload "),
    "= run": repeat("="),
    "( run": repeat("("),
    "six-layer percent encoding": layered("<script>alert(1)</script>" * 400, 6),
}


class ScanCostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.detector = HybridDetector()

    def test_hostile_inputs_scan_within_the_budget(self):
        for name, text in CASES.items():
            with self.subTest(case=name):
                self.assertLessEqual(len(text), SIZE)
                started = time.perf_counter()
                self.detector.scan(text)
                elapsed = time.perf_counter() - started
                self.assertLess(elapsed, BUDGET, f"{name}: scan took {elapsed:.2f}s for {len(text)} characters")


class ScanEndpointCostTests(ServerTestCase):
    def test_a_maximum_size_request_is_answered_within_the_budget(self):
        base = self.serve(Config())
        body = json.dumps({"text": "<" * (SIZE - 20)}).encode()
        self.assertLessEqual(len(body), Config().max_body)
        started = time.perf_counter()
        status, _, _ = call(base, "/api/scan", body)
        elapsed = time.perf_counter() - started
        self.assertEqual(status, 200)
        self.assertLess(elapsed, BUDGET, f"POST /api/scan took {elapsed:.2f}s")


if __name__ == "__main__":
    unittest.main()
