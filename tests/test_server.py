import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from xss_detector.server import Handler


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def request(self, path, body=None, raw=None, headers=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()

    def post_json(self, path, body):
        status, _, raw = self.request(path, body)
        return status, json.loads(raw)

    def test_index_and_security_headers(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"ScriptShield", body)
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_unknown_path(self):
        self.assertEqual(self.request("/nope")[0], 404)
        self.assertEqual(self.post_json("/api/nope", {})[0], 404)

    def test_scan_text(self):
        status, data = self.post_json("/api/scan", {"text": "<script>alert(1)</script>"})
        self.assertEqual(status, 200)
        self.assertTrue(data["is_malicious"])
        self.assertEqual(data["level"], "critical")

    def test_scan_fields(self):
        status, data = self.post_json("/api/scan", {"fields": {"a": "hello", "b": "<svg onload=alert(1)>"}})
        self.assertEqual(status, 200)
        self.assertFalse(data["results"]["a"]["is_malicious"])
        self.assertTrue(data["results"]["b"]["is_malicious"])

    def test_submit_rejects_xss(self):
        status, data = self.post_json("/api/submit", {"fields": {
            "name": "Ada", "email": "ada@example.com", "website": "https://example.com",
            "comment": "<img src=x onerror=alert(1)>"}})
        self.assertEqual(status, 422)
        self.assertFalse(data["accepted"])
        self.assertEqual(list(data["errors"]), ["comment"])

    def test_submit_rejects_bad_email_and_js_url(self):
        status, data = self.post_json("/api/submit", {"fields": {
            "name": "Ada", "email": "nope", "website": "ftp://example.com", "comment": ""}})
        self.assertEqual(status, 422)
        self.assertEqual(set(data["errors"]), {"email", "website"})

    def test_submit_accepts_and_escapes(self):
        status, data = self.post_json("/api/submit", {"fields": {
            "name": "Tom & Jerry", "email": "t@example.com", "website": "", "comment": "5 < 10"}})
        self.assertEqual(status, 200)
        self.assertTrue(data["accepted"])
        self.assertEqual(data["sanitized"]["name"], "Tom &amp; Jerry")
        self.assertEqual(data["sanitized"]["comment"], "5 &lt; 10")

    def test_bad_requests(self):
        self.assertEqual(self.request("/api/scan", raw=b"not json")[0], 400)
        self.assertEqual(self.request("/api/scan", raw=b"[1]")[0], 400)
        self.assertEqual(self.post_json("/api/scan", {"text": 5})[0], 400)
        self.assertEqual(self.post_json("/api/submit", {"fields": {"a": 1}})[0], 400)
        self.assertEqual(self.post_json("/api/submit", {})[0], 400)

    def test_oversized_body(self):
        status, _, _ = self.request("/api/scan", raw=b"{" + b" " * (300 * 1024) + b"}")
        self.assertEqual(status, 413)

    def test_oversized_body_gets_a_clean_413_every_time(self):
        """The server must read (drain) the rejected body, or closing the socket resets the client mid-upload."""
        for size_kb in (300, 900):
            for _ in range(15):
                status, _, raw = self.request("/api/scan", raw=b"{" + b" " * (size_kb * 1024) + b"}")
                self.assertEqual(status, 413)
                self.assertIn("error", json.loads(raw))


if __name__ == "__main__":
    unittest.main()
