import math
import threading
import unittest

from xss_detector.ratelimit import TokenBucketLimiter, client_ip


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class TokenBucketTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def limiter(self, rate=60, burst=3, **kwargs):
        return TokenBucketLimiter(rate, burst, clock=self.clock, **kwargs)

    def test_burst_is_allowed_then_denied_with_a_retry_hint(self):
        limiter = self.limiter()
        for _ in range(3):
            self.assertEqual(limiter.allow("a")[0], True)
        allowed, retry = limiter.allow("a")
        self.assertFalse(allowed)
        self.assertTrue(0 < retry <= 1, retry)
        self.clock.advance(retry)
        self.assertTrue(limiter.allow("a")[0])

    def test_refill_never_exceeds_the_burst(self):
        limiter = self.limiter()
        self.clock.advance(3600)
        results = [limiter.allow("a")[0] for _ in range(5)]
        self.assertEqual(results, [True, True, True, False, False])

    def test_keys_are_independent(self):
        limiter = self.limiter(burst=1)
        self.assertTrue(limiter.allow("a")[0])
        self.assertFalse(limiter.allow("a")[0])
        self.assertTrue(limiter.allow("b")[0])

    def test_a_cheaper_call_allows_proportionally_more_requests(self):
        limiter = self.limiter(burst=3)
        allowed = 0
        while limiter.allow("a", cost=0.25)[0]:
            allowed += 1
        self.assertEqual(allowed, 12)

    def test_a_denied_call_does_not_consume_tokens(self):
        limiter = self.limiter(burst=1)
        self.assertTrue(limiter.allow("a")[0])
        allowed, retry = limiter.allow("a")
        self.assertFalse(allowed)
        self.assertAlmostEqual(retry, 1.0)
        self.clock.advance(0.6)
        allowed, retry = limiter.allow("a")
        self.assertFalse(allowed)
        self.assertAlmostEqual(retry, 0.4)
        self.assertEqual(math.ceil(retry), 1)
        self.clock.advance(0.4)
        self.assertTrue(limiter.allow("a")[0])

    def test_table_is_bounded_and_evicts_the_least_recently_seen(self):
        limiter = self.limiter(burst=1, max_clients=3)
        for key in ("a", "b", "c"):
            self.assertTrue(limiter.allow(key)[0])
        self.assertFalse(limiter.allow("a")[0])  # a is now the most recently seen
        self.assertTrue(limiter.allow("d")[0])  # evicts b, the oldest
        self.assertEqual(len(limiter), 3)
        self.assertFalse(limiter.allow("a")[0])  # a was kept, still empty
        self.assertTrue(limiter.allow("b")[0])  # b was evicted, so it restarts with a full bucket
        self.assertEqual(len(limiter), 3)

    def test_many_distinct_clients_never_grow_the_table_past_the_cap(self):
        limiter = self.limiter(max_clients=50)
        for i in range(500):
            limiter.allow(f"10.0.0.{i}")
        self.assertEqual(len(limiter), 50)

    def test_concurrent_callers_never_get_more_than_the_burst(self):
        limiter = self.limiter(burst=100)
        granted = []

        def worker():
            granted.extend(limiter.allow("a")[0] for _ in range(50))

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sum(granted), 100)


class ClientIpTests(unittest.TestCase):
    def test_zero_hops_ignores_the_header(self):
        self.assertEqual(client_ip("9.9.9.9", "1.1.1.1", 0), "9.9.9.9")

    def test_one_hop_takes_the_last_entry(self):
        self.assertEqual(client_ip("9.9.9.9", "1.1.1.1, 2.2.2.2", 1), "2.2.2.2")

    def test_a_forged_prefix_cannot_change_the_identity(self):
        self.assertEqual(client_ip("9.9.9.9", "evil, 2.2.2.2", 1), "2.2.2.2")
        self.assertEqual(client_ip("9.9.9.9", "6.6.6.6, 2.2.2.2", 1), "2.2.2.2")

    def test_two_hops_take_the_second_from_the_right(self):
        self.assertEqual(client_ip("9.9.9.9", "1.1.1.1, 2.2.2.2, 3.3.3.3", 2), "2.2.2.2")

    def test_falls_back_to_the_peer_when_the_header_cannot_be_trusted(self):
        self.assertEqual(client_ip("9.9.9.9", None, 1), "9.9.9.9")
        self.assertEqual(client_ip("9.9.9.9", "", 1), "9.9.9.9")
        self.assertEqual(client_ip("9.9.9.9", "2.2.2.2", 2), "9.9.9.9")  # fewer entries than hops
        self.assertEqual(client_ip("9.9.9.9", "1.1.1.1, not-an-ip", 1), "9.9.9.9")

    def test_ipv6_and_whitespace_are_accepted(self):
        self.assertEqual(client_ip("9.9.9.9", "1.1.1.1 ,  2001:db8::1 ", 1), "2001:db8::1")


if __name__ == "__main__":
    unittest.main()
