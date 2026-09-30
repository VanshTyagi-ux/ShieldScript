import gzip
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tests.helpers import ServerTestCase, call
from xss_detector import server
from xss_detector.config import Config

BUNDLE = (b"console.log('hello from the bundle');\n" * 200)


class BundleCachingTests(ServerTestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.static = Path(tmp.name)
        self.bundle = self.static / "app.js"
        self.bundle.write_bytes(BUNDLE)
        patcher = mock.patch("xss_detector.server.STATIC", self.static)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.base = self.serve(Config())

    def test_headers_and_body(self):
        status, headers, body = call(self.base, "/app.js")
        self.assertEqual(status, 200)
        self.assertEqual(body, BUNDLE)
        self.assertRegex(headers["ETag"], r'^"[0-9a-f]{16,64}"$')
        self.assertEqual(headers["Cache-Control"], "no-cache")
        self.assertTrue(headers["Content-Type"].startswith("text/javascript"))
        self.assertIn("Accept-Encoding", headers["Vary"])
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])

    def test_matching_if_none_match_gives_an_empty_304_that_keeps_the_headers(self):
        etag = call(self.base, "/app.js")[1]["ETag"]
        status, headers, body = call(self.base, "/app.js", headers={"If-None-Match": etag})
        self.assertEqual((status, body), (304, b""))
        self.assertEqual(headers["ETag"], etag)
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(call(self.base, "/app.js", headers={"If-None-Match": '"nope"'})[0], 200)

    def test_gzip_is_used_only_when_the_client_accepts_it(self):
        status, headers, body = call(self.base, "/app.js", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Encoding"], "gzip")
        self.assertEqual(gzip.decompress(body), BUNDLE)
        self.assertLess(len(body), len(BUNDLE))
        self.assertEqual(int(headers["Content-Length"]), len(body))
        for accept in ("identity", "gzip;q=0", "deflate", ""):
            with self.subTest(accept=accept):
                _, plain_headers, plain = call(self.base, "/app.js", headers={"Accept-Encoding": accept})
                self.assertIsNone(plain_headers.get("Content-Encoding"))
                self.assertEqual(plain, BUNDLE)
        _, weighted, _ = call(self.base, "/app.js", headers={"Accept-Encoding": "br, gzip;q=0.5"})
        self.assertEqual(weighted["Content-Encoding"], "gzip")

    def test_each_encoding_has_its_own_etag_and_a_304_round_trips_for_gzip(self):
        gz_headers = call(self.base, "/app.js", headers={"Accept-Encoding": "gzip"})[1]
        plain_etag = call(self.base, "/app.js")[1]["ETag"]
        self.assertNotEqual(gz_headers["ETag"], plain_etag)
        status, _, body = call(self.base, "/app.js", headers={"Accept-Encoding": "gzip", "If-None-Match": gz_headers["ETag"]})
        self.assertEqual((status, body), (304, b""))

    def test_a_rebuilt_bundle_is_never_served_stale(self):
        old_etag = call(self.base, "/app.js")[1]["ETag"]
        self.bundle.write_bytes(b"console.log('rebuilt');\n" * 50)
        stat = self.bundle.stat()
        os.utime(self.bundle, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
        status, headers, body = call(self.base, "/app.js", headers={"If-None-Match": old_etag})
        self.assertEqual(status, 200)
        self.assertNotEqual(headers["ETag"], old_etag)
        self.assertEqual(body, b"console.log('rebuilt');\n" * 50)

    def test_shell_and_api_keep_no_store(self):
        for path in ("/", "/api/rules", "/api/health"):
            self.assertEqual(call(self.base, path)[1]["Cache-Control"], "no-store", path)


class MissingBundleTests(ServerTestCase):
    def test_a_missing_bundle_still_gives_the_json_404(self):
        with tempfile.TemporaryDirectory() as empty, mock.patch("xss_detector.server.STATIC", Path(empty)):
            base = self.serve(Config())
            status, _, body = call(base, "/app.js")
            self.assertEqual(status, 404)
            self.assertIn("error", json.loads(body))
            self.assertEqual(call(base, "/")[0], 200)


class RealBundleTests(ServerTestCase):
    def test_the_real_bundle_has_a_stable_etag(self):
        base = self.serve(Config())
        first = call(base, "/app.js")
        second = call(base, "/app.js")
        self.assertEqual(first[0], 200)
        self.assertRegex(first[1]["ETag"] or "", r'^"[0-9a-f]{16,64}"$')
        self.assertEqual(first[1]["ETag"], second[1]["ETag"])
        self.assertEqual(first[2], (server.STATIC / "app.js").read_bytes())


if __name__ == "__main__":
    unittest.main()
