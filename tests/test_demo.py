import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

from xss_detector import demo

ATTACK = "<img src=x onerror=\"pwned.hidden=false\">"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), demo.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.opener = urllib.request.build_opener(NoRedirect)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        for mode in demo.MODES:
            self.request("/reset", {"mode": mode})

    def request(self, path, form=None):
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        try:
            with self.opener.open(urllib.request.Request(self.base + path, data=data)) as resp:
                return resp.status, resp.headers, resp.read().decode()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read().decode()

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

    def test_routes(self):
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/demo.js")[0], 200)
        self.assertEqual(self.request("/nope")[0], 404)
        self.assertEqual(self.request("/vulnerable/other", {})[0], 404)


if __name__ == "__main__":
    unittest.main()
