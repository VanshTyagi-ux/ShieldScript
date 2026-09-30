"""Run from backend/:  python -m unittest discover -s tests -t .

The shared `app`/`client` (used by every other test file) run with the rate limiter disabled by default
(see tests/__init__.py); each test here swaps in its own small limiter (and, where needed, a different
TRUSTED_PROXY_HOPS) and restores the disabled default afterward, so these tests never interfere with the
rest of the suite or each other.
"""

import unittest

from fastapi.testclient import TestClient

from app.core import ratelimit
from app.core.config import settings
from app.main import app

client = TestClient(app)
V1 = settings.API_V1_PREFIX
SCAN = {"text": "<img src=x onerror=alert(1)>"}


class RateLimitTests(unittest.TestCase):
    def enable(self, rate=1, burst=3):
        ratelimit.limiter = ratelimit.TokenBucketLimiter(rate, burst)
        self.addCleanup(setattr, ratelimit, "limiter", None)

    def trust_hops(self, hops):
        original = settings.TRUSTED_PROXY_HOPS
        settings.TRUSTED_PROXY_HOPS = hops
        self.addCleanup(setattr, settings, "TRUSTED_PROXY_HOPS", original)

    def test_scan_is_limited_after_the_burst(self):
        self.enable(rate=1, burst=3)
        statuses = [client.post(f"{V1}/scan", json=SCAN).status_code for _ in range(3)]
        self.assertEqual(statuses, [200, 200, 200])
        r = client.post(f"{V1}/scan", json=SCAN)
        self.assertEqual(r.status_code, 429)
        self.assertGreaterEqual(int(r.headers["retry-after"]), 1)
        self.assertIn("Rate limit", r.json()["error"])

    def test_a_429_still_carries_cors_headers(self):
        self.enable(rate=1, burst=1)
        client.post(f"{V1}/scan", json=SCAN)
        r = client.post(f"{V1}/scan", json=SCAN, headers={"Origin": "http://localhost:5173"})
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_health_is_never_limited(self):
        self.enable(rate=1, burst=1)
        client.get(f"{V1}/health")
        for _ in range(5):
            self.assertEqual(client.get(f"{V1}/health").status_code, 200)

    def test_get_rules_costs_a_quarter_of_a_scan(self):
        self.enable(rate=1, burst=3)
        statuses = [client.get(f"{V1}/rules").status_code for _ in range(13)]
        self.assertEqual(statuses, [200] * 12 + [429])

    def test_submit_costs_one_token_like_scan(self):
        self.enable(rate=1, burst=3)
        fields = {"name": "Ada", "email": "ada@example.com", "website": "https://example.com", "comment": "hi"}
        statuses = [client.post(f"{V1}/submit", json={"fields": fields}).status_code for _ in range(4)]
        self.assertEqual(statuses, [200, 200, 200, 429])

    def test_trusted_proxy_hop_takes_the_forwarded_entry(self):
        self.enable(rate=1, burst=1)
        self.trust_hops(1)
        statuses = [client.post(f"{V1}/scan", json=SCAN, headers={"X-Forwarded-For": f"evil-{i}, 5.5.5.5"}).status_code
                    for i in range(2)]
        self.assertEqual(statuses, [200, 429])  # both count as 5.5.5.5, the trusted proxy's own entry

    def test_without_trusted_proxies_a_spoofed_header_does_not_bypass_the_limit(self):
        self.enable(rate=1, burst=1)
        self.trust_hops(0)  # the default: the header is not trusted at all
        statuses = [client.post(f"{V1}/scan", json=SCAN, headers={"X-Forwarded-For": f"7.7.7.{i}"}).status_code
                    for i in range(2)]
        self.assertEqual(statuses, [200, 429])  # both come from the TestClient's own fixed peer address

    def test_no_limiter_means_unlimited(self):
        ratelimit.limiter = None
        statuses = [client.post(f"{V1}/scan", json=SCAN).status_code for _ in range(30)]
        self.assertEqual(statuses, [200] * 30)


if __name__ == "__main__":
    unittest.main()
