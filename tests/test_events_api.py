import json
import unittest
import urllib.error
import urllib.request

from tests.helpers import ServerTestCase, call, start
from xss_detector.config import Config

ATTACK = "<img src=x onerror=alert(1)>"


def events(base):
    status, _, body = call(base, "/api/events")
    assert status == 200
    return json.loads(body)


class EventsApiTests(ServerTestCase):
    def test_scan_without_source_records_nothing_and_body_is_unchanged(self):
        base = self.serve(Config())
        plain = json.loads(call(base, "/api/scan", {"text": ATTACK})[2])
        self.assertEqual(events(base), {"events": [], "enabled": True})
        with_source = json.loads(call(base, "/api/scan", {"text": ATTACK, "source": "dummy-site"})[2])
        self.assertEqual(plain, with_source)

    def test_scan_fields_with_source_records_one_event_per_field(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"fields": {"name": "Ada", "comment": ATTACK}, "source": "dummy-site"})
        got = {e["field"]: e for e in events(base)["events"]}
        self.assertEqual(set(got), {"name", "comment"})
        self.assertFalse(got["name"]["blocked"])
        self.assertTrue(got["comment"]["blocked"])
        self.assertEqual(got["comment"]["source"], "dummy-site")
        self.assertIn("XSS002", got["comment"]["rules"])
        self.assertEqual(got["comment"]["text"], ATTACK)
        self.assertEqual(got["name"]["rules"], [])

    def test_scan_text_with_source_records_field_text(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"text": ATTACK, "source": "other-app"})
        (event,) = events(base)["events"]
        self.assertEqual((event["field"], event["source"], event["blocked"]), ("text", "other-app", True))

    def test_events_are_newest_first_and_capped_at_100(self):
        base = self.serve(Config(rate_limit=6000, rate_burst=6000))
        for i in range(105):
            call(base, "/api/scan", {"text": f"hello {i}", "source": "t"})
        got = events(base)["events"]
        self.assertEqual(len(got), 100)
        self.assertEqual(got[0]["text"], "hello 104")
        self.assertEqual(got[-1]["text"], "hello 5")

    def test_invalid_source_is_400_and_nothing_is_scanned_or_recorded(self):
        base = self.serve(Config())
        for bad in ("", "x" * 41, "Dummy", "a b", 5, ["x"]):
            with self.subTest(source=bad):
                status, _, body = call(base, "/api/scan", {"text": ATTACK, "source": bad})
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body)["error"],
                                 "'source' must be 1-40 lowercase letters, digits or hyphens")
        self.assertEqual(events(base)["events"], [])

    def test_events_text_is_cut_to_200_characters(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"text": "é" * 300, "source": "t"})
        self.assertEqual(events(base)["events"][0]["text"], "é" * 200)

    def test_live_feed_off_ignores_source_and_reports_disabled(self):
        base = self.serve(Config(live_feed="0"))
        plain = json.loads(call(base, "/api/scan", {"text": ATTACK})[2])
        with_source = json.loads(call(base, "/api/scan", {"text": ATTACK, "source": "dummy-site"})[2])
        self.assertEqual(plain, with_source)
        self.assertEqual(events(base), {"events": [], "enabled": False})

    def test_server_live_feed_follows_the_setting_on_a_loopback_bind(self):
        for setting, expected in (("auto", True), ("1", True), ("0", False)):
            with self.subTest(live_feed=setting):
                httpd, _ = start(Config(live_feed=setting))
                self.addCleanup(lambda h=httpd: (h.shutdown(), h.server_close()))
                self.assertIs(httpd.live_feed, expected)

    def test_live_page_serves_the_app_shell(self):
        base = self.serve(Config())
        status, headers, body = call(base, "/live")
        self.assertEqual(status, 200)
        self.assertIn(b'<div id="root">', body)

    def test_clear_empties_the_feed_and_reports_how_many(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"fields": {"name": "Ada", "comment": ATTACK}, "source": "t"})
        status, _, body = call(base, "/api/events/clear", {})
        self.assertEqual((status, json.loads(body)), (200, {"cleared": 2}))
        self.assertEqual(events(base), {"events": [], "enabled": True})
        self.assertEqual(json.loads(call(base, "/api/events/clear", {})[2]), {"cleared": 0})

    def test_ids_keep_counting_after_a_clear_through_the_api(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"text": "a", "source": "t"})
        call(base, "/api/events/clear", {})
        call(base, "/api/scan", {"text": "b", "source": "t"})
        self.assertEqual([e["id"] for e in events(base)["events"]], [2])

    def test_clear_needs_a_json_content_type(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"text": "a", "source": "t"})
        for content_type in ("text/plain", "application/x-www-form-urlencoded"):
            with self.subTest(content_type=content_type):
                request = urllib.request.Request(base + "/api/events/clear", data=b"{}", method="POST",
                                                 headers={"Content-Type": content_type})
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(request)
                self.assertEqual(ctx.exception.code, 415)
        self.assertEqual(len(events(base)["events"]), 1)

    def test_clear_rejects_a_body_that_is_not_a_json_object(self):
        base = self.serve(Config())
        self.assertEqual(call(base, "/api/events/clear", b"not json")[0], 400)
        self.assertEqual(call(base, "/api/events/clear", b"[]")[0], 400)

    def test_clear_when_the_feed_is_off_does_nothing(self):
        base = self.serve(Config(live_feed="0"))
        status, _, body = call(base, "/api/events/clear", {})
        self.assertEqual((status, json.loads(body)), (200, {"cleared": 0}))

    def test_clear_is_rate_limited_like_other_posts(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1))
        self.assertEqual(call(base, "/api/events/clear", {})[0], 200)
        self.assertEqual(call(base, "/api/events/clear", {})[0], 429)

    def test_events_endpoint_costs_a_quarter_token(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1))
        self.assertEqual([call(base, "/api/events")[0] for _ in range(4)], [200, 200, 200, 200])
        self.assertEqual(call(base, "/api/events")[0], 429)


if __name__ == "__main__":
    unittest.main()
