import json
import socket
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tests.helpers import call, start
from xss_detector import demo
from xss_detector.config import Config

ATTACK = "<img src=x onerror=\"pwned.hidden=false\">"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def start_demo(detector_url):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), demo.Handler)
    httpd.detector_url = detector_url
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def stop(httpd):
    httpd.shutdown()
    httpd.server_close()


def closed_port_url():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{sock.getsockname()[1]}"


def stub_detector(status, body):
    """A fake main site that answers every request with a fixed status and body."""
    class Stub(BaseHTTPRequestHandler):
        def _answer(self):
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            data = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = _answer

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


class DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main, cls.main_base = start(Config())
        cls.httpd, cls.base = start_demo(cls.main_base)
        cls.opener = urllib.request.build_opener(NoRedirect)

    @classmethod
    def tearDownClass(cls):
        stop(cls.httpd)
        stop(cls.main)

    def setUp(self):
        for mode in demo.MODES:
            self.request("/reset", {"mode": mode})

    def request(self, path, form=None, base=None):
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        try:
            with self.opener.open(urllib.request.Request((base or self.base) + path, data=data)) as resp:
                return resp.status, resp.headers, resp.read().decode()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read().decode()

    def events(self):
        return json.loads(call(self.main_base, "/api/events")[2])["events"]

    def last_id(self):
        events = self.events()
        return events[0]["id"] if events else 0

    def down_demo(self, url=None):
        httpd, base = start_demo(url or closed_port_url())
        self.addCleanup(stop, httpd)
        return base

    def test_vulnerable_board_echoes_raw_html(self):
        status, _, _ = self.request("/vulnerable/comment", {"name": "Mallory", "comment": ATTACK})
        self.assertEqual(status, 303)
        _, headers, body = self.request("/vulnerable")
        self.assertIn(ATTACK, body)  # attacker markup lands in the page unescaped
        self.assertNotIn("Content-Security-Policy", headers)
        self.assertIn("session=", headers["Set-Cookie"])

    def test_protected_board_rejects_attack(self):
        for payload in (ATTACK, "%3Cscript%3Ealert(1)%3C/script%3E"):
            status, headers, body = self.request("/protected/comment", {"name": "Mallory", "comment": payload})
            self.assertEqual(status, 422)
            self.assertIn("Rejected", body)
            self.assertNotIn(ATTACK, body)  # the echoed form value is escaped
            self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
        _, _, board = self.request("/protected")
        self.assertNotIn("Mallory", board)  # nothing was stored

    def test_protected_board_rejects_attack_in_name(self):
        status, _, _ = self.request("/protected/comment", {"name": "<script>alert(1)</script>", "comment": "hi"})
        self.assertEqual(status, 422)

    def test_protected_board_escapes_benign_markup(self):
        status, _, _ = self.request("/protected/comment", {"name": "Ada", "comment": "5 < 10 & <3"})
        self.assertEqual(status, 303)
        _, _, body = self.request("/protected")
        self.assertIn("5 &lt; 10 &amp; &lt;3", body)

    def test_protected_comment_scan_goes_through_the_main_site(self):
        before = self.last_id()
        self.request("/protected/comment", {"name": "Mallory", "comment": ATTACK})
        new = [e for e in self.events() if e["id"] > before]
        blocked = [e for e in new if e["field"] == "comment"]
        self.assertEqual(len(blocked), 1)
        self.assertTrue(blocked[0]["blocked"])
        self.assertEqual(blocked[0]["source"], "dummy-site")
        self.assertEqual(blocked[0]["text"], ATTACK)

    def test_benign_protected_comment_is_recorded_as_allowed(self):
        before = self.last_id()
        self.assertEqual(self.request("/protected/comment", {"name": "Ada", "comment": "Nice post"})[0], 303)
        new = {e["field"]: e for e in self.events() if e["id"] > before}
        self.assertEqual(set(new), {"name", "comment"})
        self.assertFalse(new["comment"]["blocked"])

    def test_vulnerable_mode_makes_no_scan_call(self):
        before = self.last_id()
        self.request("/vulnerable/comment", {"name": "Mallory", "comment": ATTACK})
        self.request("/vulnerable/search?q=" + urllib.parse.quote(ATTACK))
        self.assertEqual(self.last_id(), before)

    def test_search_vulnerable_echoes_raw_query(self):
        status, headers, body = self.request("/vulnerable/search?q=" + urllib.parse.quote(ATTACK))
        self.assertEqual(status, 200)
        self.assertIn(ATTACK, body)
        self.assertNotIn("Content-Security-Policy", headers)

    def test_search_protected_blocks_attack_and_never_echoes_it_raw(self):
        status, headers, body = self.request("/protected/search?q=" + urllib.parse.quote(ATTACK))
        self.assertEqual(status, 422)
        self.assertIn("Rejected", body)
        self.assertNotIn(ATTACK, body)
        self.assertIn("script-src 'self'", headers["Content-Security-Policy"])

    def test_search_protected_escapes_benign_query(self):
        status, _, body = self.request("/protected/search?q=" + urllib.parse.quote("5 < 10"))
        self.assertEqual(status, 200)
        self.assertIn("5 &lt; 10", body)

    def test_empty_search_makes_no_scan_and_no_event(self):
        before = self.last_id()
        for mode in ("protected", "vulnerable"):
            self.assertEqual(self.request(f"/{mode}/search?q=")[0], 200)
            self.assertEqual(self.request(f"/{mode}/search")[0], 200)
        self.assertEqual(self.last_id(), before)

    def test_protected_fails_closed_when_the_main_site_is_down(self):
        base = self.down_demo()
        status, _, body = self.request("/protected/comment", {"name": "Ada", "comment": "hello"}, base)
        self.assertEqual(status, 503)
        self.assertIn("Detector unavailable, input not accepted", body)
        self.assertNotIn("hello", self.request("/protected", base=base)[2].split("<h2>Comments</h2>")[1])
        status, _, body = self.request("/protected/search?q=hello", base=base)
        self.assertEqual(status, 503)
        self.assertIn("Detector unavailable, input not accepted", body)

    def test_protected_fails_closed_on_malformed_detector_answer(self):
        answers = ('{"results": {}}', "not json", '{"results": {"name": {}, "comment": {}}}')
        for body in answers:
            with self.subTest(body=body):
                stub, url = stub_detector(200, body)
                self.addCleanup(stop, stub)
                base = self.down_demo(url)
                status, _, page = self.request("/protected/comment", {"name": "Ada", "comment": "hi"}, base)
                self.assertEqual(status, 503)
                self.assertIn("Detector unavailable", page)

    def test_scan_via_api_treats_429_and_500_as_unavailable(self):
        for code in (429, 500):
            with self.subTest(status=code):
                stub, url = stub_detector(code, '{"error": "no"}')
                self.addCleanup(stop, stub)
                with self.assertRaises(demo.DetectorUnavailable):
                    demo.scan_via_api(url, {"q": "x"})

    def test_scan_via_api_returns_a_result_per_field(self):
        results = demo.scan_via_api(self.main_base, {"name": "Ada", "comment": ATTACK})
        self.assertFalse(results["name"]["is_malicious"])
        self.assertTrue(results["comment"]["is_malicious"])

    def test_home_shows_detector_status_and_link_to_live(self):
        _, _, up = self.request("/")
        self.assertIn("Detector reachable", up)
        self.assertIn(f'href="{self.main_base}/live"', up)
        _, _, down = self.request("/", base=self.down_demo())
        self.assertIn("Detector not reachable", down)

    def test_pages_are_responsive_and_follow_the_system_colour_scheme(self):
        for path in ("/", "/vulnerable", "/protected"):
            with self.subTest(path=path):
                body = self.request(path)[2]
                self.assertIn('name="viewport"', body)
                self.assertIn("prefers-color-scheme: dark", body)
                self.assertIn("@media (max-width", body)

    def test_pages_share_a_header_and_the_nav_marks_the_current_page(self):
        for path in ("/", "/vulnerable", "/protected"):
            self.assertIn('class="site-header"', self.request(path)[2])
        vulnerable = self.request("/vulnerable")[2]
        self.assertRegex(vulnerable, r'<a href="/vulnerable"[^>]*aria-current="page"')
        self.assertNotRegex(vulnerable, r'<a href="/protected"[^>]*aria-current')
        protected = self.request("/protected")[2]
        self.assertRegex(protected, r'<a href="/protected"[^>]*aria-current="page"')
        self.assertNotRegex(protected, r'<a href="/vulnerable"[^>]*aria-current')

    def test_each_board_shows_its_status_strip(self):
        self.assertIn('class="banner insecure"', self.request("/vulnerable")[2])
        self.assertIn('class="banner protected"', self.request("/protected")[2])
        self.assertNotIn('class="banner protected"', self.request("/vulnerable")[2])

    def test_comments_show_an_avatar_with_the_authors_first_letter(self):
        self.request("/protected/comment", {"name": "ada", "comment": "Nice post"})
        board = self.request("/protected")[2].split("<h2>Comments</h2>")[1]
        self.assertIn('<span class="avatar" aria-hidden="true">A</span>', board)
        self.request("/protected/comment", {"name": "5 < 10", "comment": "hi"})
        self.assertIn('<span class="avatar" aria-hidden="true">5</span>', self.request("/protected")[2])

    def test_rejections_are_alerts_and_the_stolen_cookie_banner_is_still_there(self):
        _, _, body = self.request("/protected/comment", {"name": "Mallory", "comment": ATTACK})
        self.assertIn('role="alert"', body)
        self.assertIn("Rejected", body)
        self.assertIn('id="pwned"', self.request("/vulnerable")[2])

    def test_routes(self):
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/demo.js")[0], 200)
        self.assertEqual(self.request("/nope")[0], 404)
        self.assertEqual(self.request("/vulnerable/other", {})[0], 404)


if __name__ == "__main__":
    unittest.main()
