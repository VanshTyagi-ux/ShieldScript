import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from html.parser import HTMLParser
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from xss_detector import server
from xss_detector.server import STATIC, Handler, check_bundle


class _Tags(HTMLParser):
    """Collects what a CSP of default-src 'self' would block: inline scripts/styles, style= and on*= attributes."""

    def __init__(self):
        super().__init__()
        self.inline_scripts = self.style_tags = 0
        self.bad_attrs = []

    def handle_starttag(self, tag, attrs):
        names = {name for name, _ in attrs}
        if tag == "script" and "src" not in names:
            self.inline_scripts += 1
        if tag == "style":
            self.style_tags += 1
        self.bad_attrs += [(tag, n) for n in names if n == "style" or n.startswith("on")]


class FrontendServingTests(unittest.TestCase):
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

    def test_root_serves_generated_shell(self):
        status, headers, body = self.get("/")
        html = body.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        for expected in ("<title>XSS Detector</title>", '<div id="root">', '<script src="/app.js"></script>', "<noscript>"):
            self.assertIn(expected, html)

    def test_shell_head_has_icon_description_theme_color_and_open_graph(self):
        html = self.get("/")[2].decode("utf-8")
        for expected in ('rel="icon"', 'name="description"', 'name="theme-color"', 'media="(prefers-color-scheme: dark)"',
                         'property="og:title"', 'property="og:description"', 'property="og:type"'):
            self.assertIn(expected, html)

    def test_shell_shows_a_visible_message_if_the_bundle_never_loads(self):
        """React replaces #root's contents on mount; if app.js is missing the user still sees why."""
        html = self.get("/")[2].decode("utf-8")
        self.assertRegex(html, r'(?s)<div id="root">.*npm run build.*</div>')

    def test_root_with_query_string_serves_shell(self):
        status, _, body = self.get("/?x=1")
        self.assertEqual(status, 200)
        self.assertIn(b'<div id="root">', body)

    def test_shell_is_csp_clean(self):
        tags = _Tags()
        tags.feed(self.get("/")[2].decode("utf-8"))
        self.assertEqual(tags.inline_scripts, 0)
        self.assertEqual(tags.style_tags, 0)
        self.assertEqual(tags.bad_attrs, [])

    def test_app_js_is_served(self):
        status, headers, body = self.get("/app.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/javascript"))
        self.assertGreater(len(body), 0)

    def test_removed_and_unknown_paths_are_404(self):
        for path in ("/style.css", "/index.html", "/assets/app.js", "/static/app.js", "/../server.py", "/%2e%2e/server.py"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)

    def test_missing_bundle_gives_json_404_but_shell_still_served(self):
        with tempfile.TemporaryDirectory() as empty, mock.patch.object(server, "STATIC", Path(empty)):
            status, _, body = self.get("/app.js")
            self.assertEqual(status, 404)
            self.assertIn("error", json.loads(body))
            self.assertEqual(self.get("/")[0], 200)


class BundleTests(unittest.TestCase):
    def test_check_bundle_warns_when_missing(self):
        with tempfile.TemporaryDirectory() as empty, mock.patch.object(server, "STATIC", Path(empty)):
            with self.assertLogs("xss_detector.server", "WARNING"):
                self.assertFalse(check_bundle())

    def test_check_bundle_is_quiet_when_present(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(server, "STATIC", Path(folder)):
            (Path(folder) / "app.js").write_text("// built", encoding="utf-8")
            self.assertTrue(check_bundle())

    def test_static_dir_contains_only_the_bundle(self):
        self.assertEqual(sorted(p.name for p in STATIC.iterdir() if p.is_file()), ["app.js"])


if __name__ == "__main__":
    unittest.main()
