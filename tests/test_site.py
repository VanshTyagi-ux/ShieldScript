import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from xss_detector import server
from xss_detector.detector import DEFAULT_RULES, OBFUSCATION_RULE
from xss_detector.server import PAGES, Handler


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()

    # -- pages ---------------------------------------------------------------
    def test_every_page_route_serves_the_app(self):
        for path in PAGES:
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 200)
                self.assertTrue(headers["Content-Type"].startswith("text/html"))
                self.assertIn(b'<div id="root">', body)

    def test_trailing_slash_and_query_string_still_serve_the_page(self):
        self.assertEqual(self.get("/scanner/")[0], 200)
        self.assertEqual(self.get("/scanner?t=abc")[0], 200)

    def test_unknown_pages_are_a_real_404_that_still_serves_the_app(self):
        for path in ("/nope", "/api", "/rules/xyz"):
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertTrue(headers["Content-Type"].startswith("text/html"))
                self.assertIn(b'<div id="root">', body)

    def test_unknown_files_and_api_paths_stay_json_404(self):
        for path in ("/nope.txt", "/style.css", "/api/nope"):
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertIn("error", json.loads(body))

    def test_favicon(self):
        status, headers, body = self.get("/favicon.svg")
        text = body.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/svg+xml")
        self.assertTrue(text.startswith("<svg"))
        self.assertIn("xmlns", text)
        self.assertNotIn("<script", text)
        self.assertIsNone(re.search(r"\son[a-z]+\s*=", text))

    # -- endpoints -----------------------------------------------------------
    def test_health(self):
        status, _, body = self.get("/api/health")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["rules"], len(DEFAULT_RULES))
        self.assertIsInstance(data["ml_loaded"], bool)

    def test_rules_catalog(self):
        status, _, body = self.get("/api/rules")
        data = json.loads(body)
        self.assertEqual(status, 200)
        rules = data["rules"]
        self.assertEqual(len(rules), len(DEFAULT_RULES) + 1)
        self.assertEqual([r["id"] for r in rules[:-1]], [r.id for r in DEFAULT_RULES])
        self.assertEqual(rules[-1]["id"], OBFUSCATION_RULE.id)
        self.assertTrue(rules[-1]["derived"])
        self.assertFalse(any(r["derived"] for r in rules[:-1]))
        self.assertTrue(all(isinstance(r["weight"], int) and r["name"] and r["category"] and r["description"] for r in rules))
        self.assertEqual(data["levels"], [{"name": "safe", "min": 0}, {"name": "low", "min": 1}, {"name": "medium", "min": 25},
                                          {"name": "high", "min": 50}, {"name": "critical", "min": 75}])
        self.assertEqual(data["block_threshold"], 25)

    def test_benchmark_is_served_when_present(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(server, "BENCHMARK_PATH", Path(tmp) / "b.json"):
            sample = {"generated": "2026-09-28", "detectors": []}
            (Path(tmp) / "b.json").write_text(json.dumps(sample), encoding="utf-8")
            status, headers, body = self.get("/api/benchmark")
            self.assertEqual(status, 200)
            self.assertTrue(headers["Content-Type"].startswith("application/json"))
            self.assertEqual(json.loads(body), sample)

    def test_benchmark_missing_explains_how_to_generate_it(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(server, "BENCHMARK_PATH", Path(tmp) / "none.json"):
            status, _, body = self.get("/api/benchmark")
            self.assertEqual(status, 404)
            self.assertIn("python -m xss_detector evaluate", json.loads(body)["error"])

    def test_benchmark_corrupt_is_a_500(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(server, "BENCHMARK_PATH", Path(tmp) / "b.json"):
            (Path(tmp) / "b.json").write_text("{not json", encoding="utf-8")
            status, _, body = self.get("/api/benchmark")
            self.assertEqual(status, 500)
            self.assertIn("error", json.loads(body))

    def test_security_headers_on_every_new_response(self):
        for path in ("/", "/nope", "/favicon.svg", "/api/health", "/api/rules", "/api/benchmark"):
            with self.subTest(path=path):
                _, headers, _ = self.get(path)
                self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")


if __name__ == "__main__":
    unittest.main()
