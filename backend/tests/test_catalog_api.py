"""health, rules, benchmark and payload facets.  Run from backend/:  python -m unittest discover -s tests -t ."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.repo import ensure_repo_importable
from app.main import app
from app.services import benchmark as bench
from app.services import detector as svc
from app.services import payloads as payload_svc

ensure_repo_importable()
from xss_detector.detector import DEFAULT_RULES  # noqa: E402

V1 = settings.API_V1_PREFIX
client = TestClient(app)


class HealthTests(unittest.TestCase):
    def test_reports_rules_and_model_state(self):
        r = client.get(f"{V1}/health")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["rules"], len(DEFAULT_RULES))
        self.assertEqual(body["ml_loaded"], svc.detector.ml is not None)
        self.assertEqual({"status", "service", "version", "rules", "ml_loaded"}, set(body))


class RulesTests(unittest.TestCase):
    def test_catalog(self):
        r = client.get(f"{V1}/rules")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual([x["id"] for x in body["rules"][:-1]], [rule.id for rule in DEFAULT_RULES])
        last = body["rules"][-1]
        self.assertEqual((last["id"], last["derived"]), ("XSS099", True))
        self.assertFalse(any(x["derived"] for x in body["rules"][:-1]))
        self.assertEqual([(x["name"], x["min"]) for x in body["levels"]],
                         [("safe", 0), ("low", 1), ("medium", 25), ("high", 50), ("critical", 75)])
        self.assertEqual(body["block_threshold"], 25)

    def test_same_data_as_the_stdlib_servers_catalog(self):
        from xss_detector.catalog import rules_payload
        self.assertEqual(client.get(f"{V1}/rules").json(), rules_payload(25))


class BenchmarkTests(unittest.TestCase):
    def serve(self, content):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "b.json"
        if content is not None:
            path.write_bytes(content if isinstance(content, bytes) else json.dumps(content).encode())
        patcher = mock.patch.object(bench, "BENCHMARK_PATH", path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_returns_the_file_unchanged(self):
        report = {"generated": "2026-01-02", "detectors": [{"name": "Rules", "recall": 0.5, "note": "é😀"}], "notes": []}
        self.serve(report)
        r = client.get(f"{V1}/benchmark")
        self.assertEqual((r.status_code, r.json()), (200, report))

    def test_missing_is_404_with_the_instruction(self):
        self.serve(None)
        r = client.get(f"{V1}/benchmark")
        self.assertEqual(r.status_code, 404)
        self.assertIn("python -m xss_detector evaluate", r.json()["error"])

    def test_corrupt_or_wrong_shape_is_500(self):
        for content in (b"{not json", b"[1, 2]", b"\xff\xfe"):
            with self.subTest(content):
                self.serve(content)
                r = client.get(f"{V1}/benchmark")
                self.assertEqual((r.status_code, r.json()), (500, {"error": "Benchmark file is unreadable"}))

    def test_the_shipped_report_is_served(self):
        r = client.get(f"{V1}/benchmark")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["detectors"]), 4)
        self.assertEqual([d["name"] for d in r.json()["detectors"] if d["shipped"]], ["Hybrid (rules; ML escalates)"])


class FacetTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        app.dependency_overrides[get_db] = lambda: (yield self.db)
        self.addCleanup(app.dependency_overrides.pop, get_db, None)

    def test_empty_database(self):
        r = client.get(f"{V1}/payloads/facets")
        self.assertEqual((r.status_code, r.json()), (200, {"total": 0, "categories": [], "sources": []}))

    def test_counts_are_grouped_and_sorted_largest_first_then_by_name(self):
        cats = {"a.txt": "standard", "b.txt": "bypass", "c.txt": "bypass"}
        payload_svc.load_payloads(self.db, {"a.txt": ["a1a", "a2a", "a3a"], "b.txt": ["b1b"], "c.txt": ["c1c"]},
                                  category_for=cats.__getitem__)
        body = client.get(f"{V1}/payloads/facets").json()
        self.assertEqual(body["total"], 5)
        self.assertEqual(body["categories"], [{"name": "standard", "count": 3}, {"name": "bypass", "count": 2}])
        self.assertEqual(body["sources"], [{"name": "a.txt", "count": 3}, {"name": "b.txt", "count": 1},
                                           {"name": "c.txt", "count": 1}])

    def test_facets_is_not_mistaken_for_a_payload_id(self):
        self.assertEqual(client.get(f"{V1}/payloads/facets").status_code, 200)
        self.assertEqual(client.get(f"{V1}/payloads/1").status_code, 404)

    def test_facet_counts_agree_with_the_listing_totals(self):
        cats = {"a.txt": "standard", "b.txt": "bypass"}
        payload_svc.load_payloads(self.db, {"a.txt": [f"a-{i}x" for i in range(7)], "b.txt": ["b1b", "b2b"]},
                                  category_for=cats.__getitem__)
        facets = client.get(f"{V1}/payloads/facets").json()
        for facet in facets["categories"]:
            listed = client.get(f"{V1}/payloads", params={"category": facet["name"]}).json()["total"]
            self.assertEqual(listed, facet["count"])
        for facet in facets["sources"]:
            listed = client.get(f"{V1}/payloads", params={"source_file": facet["name"]}).json()["total"]
            self.assertEqual(listed, facet["count"])


if __name__ == "__main__":
    unittest.main()
