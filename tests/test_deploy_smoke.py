"""End to end: run the real CLI in a subprocess configured only through environment variables, as a platform would."""

import gzip
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from tests.helpers import call

MARKER = "SMOKE-BODY-MARKER"
ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class DeploySmokeTests(unittest.TestCase):
    def setUp(self):
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
        self.log_path = Path(log.name)
        self.addCleanup(lambda: self.log_path.unlink(missing_ok=True))
        env = {**os.environ, "PORT": str(self.port), "HOST": "127.0.0.1", "LOG_FORMAT": "json",
               "RATE_LIMIT": "1", "RATE_BURST": "3", "TRUSTED_PROXY_HOPS": "0", "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen([sys.executable, "-m", "xss_detector", "serve"], env=env, stderr=log,
                                     stdout=subprocess.DEVNULL, cwd=str(ROOT))
        log.close()
        self.addCleanup(self.stop)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and self.proc.poll() is None:
            try:
                if call(self.base, "/api/health")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)
        self.fail("the server did not become healthy")

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    def test_the_whole_deployment_contract(self):
        # Settings come from the environment: it listens on $PORT and reports a healthy bundle.
        status, _, body = call(self.base, "/api/health")
        self.assertEqual(status, 200)
        self.assertIs(json.loads(body)["bundle"], True)

        # Rate limiting: a burst of 3, then 429 with Retry-After.
        first = call(self.base, "/api/scan", {"text": f"hello {MARKER}"})
        self.assertEqual(first[0], 200)
        self.assertEqual([call(self.base, "/api/scan", {"text": "a"})[0] for _ in range(2)], [200, 200])
        status, headers, _ = call(self.base, "/api/scan", {"text": "a"})
        self.assertEqual(status, 429)
        self.assertGreaterEqual(int(headers["Retry-After"]), 1)

        # Health and the bundle stay reachable while limited, and the bundle is gzipped.
        self.assertEqual(call(self.base, "/api/health")[0], 200)
        status, headers, body = call(self.base, "/app.js", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Encoding"], "gzip")
        self.assertGreater(len(gzip.decompress(body)), len(body))

        # Headers on a normal response.
        headers = first[1]
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertIn("Permissions-Policy", headers)
        self.assertRegex(headers["X-Request-Id"], r"^[0-9a-f]{32}$")

        # Logs: every line is a JSON object, requests are recorded, bodies never are.
        self.stop()
        lines = [line for line in self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
                 if line.strip()]
        self.assertTrue(lines, "no log output")
        entries = [json.loads(line) for line in lines]  # raises if any line is not JSON
        self.assertTrue(any("Serving on" in entry["msg"] for entry in entries))
        self.assertTrue(any(e.get("path") == "/api/scan" and e.get("status") == 200 for e in entries))
        self.assertTrue(any(e.get("status") == 429 for e in entries))
        self.assertNotIn(MARKER, "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
