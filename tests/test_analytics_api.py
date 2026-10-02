import json
import unittest

from tests.helpers import ServerTestCase, call
from xss_detector.config import Config
from xss_detector.server import API_COSTS

ATTACK = "<img src=x onerror=alert(1)>"
KEYS = {"enabled", "range", "generated", "bucket", "totals", "timeline", "levels", "rules", "categories", "sources",
        "fields", "scores", "recent_critical"}


def get_json(base, path):
    status, _, body = call(base, path)
    return status, json.loads(body)


class AnalyticsRouteTests(ServerTestCase):
    def seeded(self):
        base = self.serve(Config())
        for text in ("alpha one", "bravo two", ATTACK):
            call(base, "/api/scan", {"text": text, "source": "blog"})
        return base

    def test_analytics_summarises_seeded_scans(self):
        status, body = get_json(self.seeded(), "/api/analytics")
        self.assertEqual(status, 200)
        self.assertIs(body["enabled"], True)
        self.assertEqual(body["range"], "24h")
        self.assertEqual(set(body), KEYS)
        self.assertEqual(body["totals"]["scans"], 3)
        self.assertEqual(body["totals"]["blocked"], 1)
        rules = {r["rule_id"]: r for r in body["rules"]}
        self.assertEqual(rules["XSS002"]["name"], "Inline event handler (known)")
        self.assertEqual(body["recent_critical"][0]["text"], ATTACK)
        self.assertEqual(body["sources"][0]["source"], "blog")

    def test_each_range_is_accepted_with_its_bucket(self):
        base = self.seeded()
        expected = {"1h": ("5min", 12), "24h": ("hour", 24), "7d": ("day", 7), "all": ("day", None)}
        for key, (bucket, size) in expected.items():
            with self.subTest(range=key):
                status, body = get_json(base, f"/api/analytics?range={key}")
                self.assertEqual(status, 200)
                self.assertEqual(body["bucket"], bucket)
                self.assertEqual(len(body["timeline"]), size) if size else self.assertGreaterEqual(len(body["timeline"]), 1)
                self.assertEqual(body["totals"]["scans"], 3)

    def test_a_bad_range_is_400(self):
        base = self.seeded()
        for query in ("?range=2h", "?range="):
            with self.subTest(query=query):
                status, body = get_json(base, "/api/analytics" + query)
                self.assertEqual(status, 400)
                self.assertIn("error", body)

    def test_analytics_when_storing_is_off(self):
        base = self.serve(Config(), host="0.0.0.0")
        self.assertEqual(get_json(base, "/api/analytics"), (200, {"enabled": False}))

    def test_the_route_has_the_documented_cost_and_the_page_exists(self):
        self.assertEqual(API_COSTS[("GET", "/api/analytics")], 0.5)
        status, _, body = call(self.serve(Config()), "/dashboard")
        self.assertEqual(status, 200)
        self.assertIn(b'<div id="root">', body)


if __name__ == "__main__":
    unittest.main()
