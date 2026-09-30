import http.client
import json
import math
import socket
import threading
import time
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from tests.helpers import ServerTestCase, call, start, wait_for
from xss_detector import server
from xss_detector.config import Config
from xss_detector.server import Handler, HardenedServer, make_server

SCAN = {"text": "hello"}
SUBMIT = {"fields": {"name": "Ada", "email": "", "website": "", "comment": "hi"}}


class RateLimitTests(ServerTestCase):
    def test_scan_is_limited_after_the_burst(self):
        base = self.serve(Config(rate_limit=1, rate_burst=3))
        self.assertEqual([call(base, "/api/scan", SCAN)[0] for _ in range(3)], [200, 200, 200])
        status, headers, body = call(base, "/api/scan", SCAN)
        self.assertEqual(status, 429)
        self.assertGreaterEqual(int(headers["Retry-After"]), 1)
        self.assertIn("Rate limit", json.loads(body)["error"])
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])

    def test_a_429_on_a_post_with_a_large_body_arrives_as_json_not_a_reset(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1))
        self.assertEqual(call(base, "/api/scan", SCAN)[0], 200)
        big = json.dumps({"text": "x" * 100_000}).encode()
        status, _, body = call(base, "/api/scan", big)
        self.assertEqual(status, 429)
        self.assertIn("error", json.loads(body))

    def test_health_and_the_static_pages_are_never_limited(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1))
        call(base, "/api/scan", SCAN)
        self.assertEqual(call(base, "/api/scan", SCAN)[0], 429)
        for path in ("/api/health", "/", "/scanner", "/app.js", "/favicon.svg"):
            self.assertEqual(call(base, path)[0], 200, path)

    def test_get_rules_costs_a_quarter_of_a_scan(self):
        base = self.serve(Config(rate_limit=1, rate_burst=3))
        statuses = [call(base, "/api/rules")[0] for _ in range(13)]
        self.assertEqual(statuses, [200] * 12 + [429])

    def test_submit_costs_one_token_like_scan(self):
        base = self.serve(Config(rate_limit=1, rate_burst=3))
        statuses = [call(base, "/api/submit", SUBMIT)[0] for _ in range(4)]
        self.assertEqual(statuses, [200, 200, 200, 429])

    def test_a_forged_forwarded_for_prefix_cannot_dodge_or_borrow_a_limit(self):
        base = self.serve(Config(rate_limit=1, rate_burst=2, trusted_proxy_hops=1))
        statuses = [call(base, "/api/scan", SCAN, {"X-Forwarded-For": f"evil-{i}, 5.5.5.5"})[0] for i in range(3)]
        self.assertEqual(statuses, [200, 200, 429])
        self.assertEqual(call(base, "/api/scan", SCAN, {"X-Forwarded-For": "6.6.6.6"})[0], 200)

    def test_without_trusted_proxies_the_header_is_ignored(self):
        base = self.serve(Config(rate_limit=1, rate_burst=2, trusted_proxy_hops=0))
        statuses = [call(base, "/api/scan", SCAN, {"X-Forwarded-For": f"7.7.7.{i}"})[0] for i in range(3)]
        self.assertEqual(statuses, [200, 200, 429])

    def test_a_plain_threading_server_has_no_limiting(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        self.assertEqual({call(base, "/api/scan", SCAN)[0] for _ in range(50)}, {200})


class ConfigWiringTests(ServerTestCase):
    def test_max_body_comes_from_the_config(self):
        base = self.serve(Config(max_body=1000))
        status, _, body = call(base, "/api/scan", {"text": "a" * 2000})
        self.assertEqual(status, 413)
        self.assertIn("1000", json.loads(body)["error"])

    def test_host_and_port_arguments_override_the_config(self):
        httpd = make_server(Config(host="0.0.0.0", port=1234), host="127.0.0.1", port=0)
        self.addCleanup(httpd.server_close)
        host, port = httpd.server_address
        self.assertEqual(host, "127.0.0.1")
        self.assertNotEqual(port, 1234)
        self.assertGreater(port, 0)

    def test_the_server_carries_its_config_and_a_limiter(self):
        httpd = make_server(Config(rate_limit=5, rate_burst=2), port=0)
        self.addCleanup(httpd.server_close)
        self.assertEqual(httpd.config.rate_burst, 2)
        self.assertTrue(httpd.limiter.allow("x")[0])
        self.assertFalse(math.isnan(httpd.limiter.allow("x")[1]))


CSP = "default-src 'self'; frame-ancestors 'none'"


class HeaderTests(ServerTestCase):
    def responses(self, base):
        yield call(base, "/")
        yield call(base, "/nope")
        yield call(base, "/api/health")
        yield call(base, "/api/rules")
        yield call(base, "/api/nope")
        yield call(base, "/api/submit", {"fields": {"name": "a", "email": "not-an-email", "website": "", "comment": ""}})

    def test_every_response_carries_the_extra_security_headers_and_the_unchanged_csp(self):
        base = self.serve(Config())
        for status, headers, _ in self.responses(base):
            with self.subTest(status=status):
                self.assertEqual(headers["Content-Security-Policy"], CSP)
                self.assertEqual(headers["Permissions-Policy"], "geolocation=(), camera=(), microphone=()")
                self.assertEqual(headers["Cross-Origin-Opener-Policy"], "same-origin")

    def test_a_429_carries_them_too(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1))
        call(base, "/api/scan", SCAN)
        status, headers, _ = call(base, "/api/scan", SCAN)
        self.assertEqual(status, 429)
        self.assertEqual(headers["Permissions-Policy"], "geolocation=(), camera=(), microphone=()")

    def test_hsts_is_off_by_default_and_on_when_enabled(self):
        base = self.serve(Config())
        self.assertTrue(all("Strict-Transport-Security" not in h for _, h, _ in self.responses(base)))
        base = self.serve(Config(enable_hsts=True))
        for status, headers, _ in self.responses(base):
            with self.subTest(status=status):
                self.assertEqual(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains")


class HealthTests(ServerTestCase):
    def test_healthy_reports_the_bundle(self):
        base = self.serve(Config())
        status, _, body = call(base, "/api/health")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual((data["status"], data["bundle"]), ("ok", True))
        self.assertIsInstance(data["rules"], int)
        self.assertIsInstance(data["ml_loaded"], bool)

    def test_a_missing_bundle_makes_health_503_so_no_traffic_is_routed(self):
        with tempfile.TemporaryDirectory() as empty, mock.patch("xss_detector.server.STATIC", Path(empty)):
            base = self.serve(Config())
            status, _, body = call(base, "/api/health")
            data = json.loads(body)
            self.assertEqual(status, 503)
            self.assertIs(data["bundle"], False)
            self.assertNotEqual(data["status"], "ok")


LOGGER = "xss_detector.server"


class HostileBodyTests(ServerTestCase):
    """Review finding 3: deeply nested JSON must not crash the handler, and only the two POST routes parse bodies."""

    def test_deeply_nested_json_is_a_clean_400(self):
        base = self.serve(Config())
        status, _, body = call(base, "/api/scan", b"[" * 200_000)
        self.assertEqual(status, 400)
        self.assertIn("error", json.loads(body))

    def test_a_post_to_any_other_path_is_a_404_without_parsing_the_body(self):
        base = self.serve(Config())
        for path in ("/scanner", "/api/nope", "/"):
            with self.subTest(path=path):
                self.assertEqual(call(base, path, b"[" * 200_000)[0], 404)
                self.assertEqual(call(base, path, {"text": "hello"})[0], 404)

    def test_an_unexpected_handler_error_is_one_log_record_with_the_traceback(self):
        class Boom(Handler):
            def do_GET(self):
                raise RuntimeError("kaboom")

        httpd = HardenedServer(("127.0.0.1", 0), Boom, Config())
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        with self.assertLogs(LOGGER, "ERROR") as cm:
            try:
                call(base, "/x")
            except Exception:
                pass  # the server drops the connection; the log record is written before it closes
        self.assertTrue(any(r.exc_info and "kaboom" in str(r.exc_info[1]) for r in cm.records))

    def test_a_client_that_disconnects_mid_request_is_not_an_error(self):
        class Dropped(Handler):
            def do_GET(self):
                raise ConnectionResetError("client went away")

        httpd = HardenedServer(("127.0.0.1", 0), Dropped, Config())
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        with self.assertNoLogs(LOGGER, "ERROR"):
            try:
                call(base, "/x")
            except Exception:
                pass


class ForwardedForLinesTests(ServerTestCase):
    """Review finding 2: several X-Forwarded-For header lines are one list (RFC 9110 5.3), read right to left."""

    def post(self, base, lines):
        conn = http.client.HTTPConnection("127.0.0.1", int(base.rsplit(":", 1)[1]))
        body = json.dumps(SCAN).encode()
        conn.putrequest("POST", "/api/scan")
        for value in lines:
            conn.putheader("X-Forwarded-For", value)
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        try:
            return conn.getresponse().status
        finally:
            conn.close()

    def test_a_client_written_line_before_the_proxys_line_cannot_choose_the_identity(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1, trusted_proxy_hops=1))
        statuses = [self.post(base, [f"1.1.1.{i}", "5.5.5.5"]) for i in range(1, 4)]
        self.assertEqual(statuses, [200, 429, 429])  # all three are 5.5.5.5, the proxy's entry

    def test_the_proxy_may_append_to_a_line_the_client_sent(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1, trusted_proxy_hops=1))
        statuses = [self.post(base, [f"9.9.9.{i}, 1.1.1.{i}", "5.5.5.5"]) for i in range(1, 3)]
        self.assertEqual(statuses, [200, 429])


class SlowDripTests(ServerTestCase):
    """Review finding 1: the timeout must bound a whole request, not one socket read."""

    class Dripping(Handler):
        timeout = 0.5   # per socket read
        deadline = 0.6  # whole request

    def start(self):
        httpd = HardenedServer(("127.0.0.1", 0), self.Dripping, Config())
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        return httpd

    def test_a_client_dripping_bytes_is_cut_off_at_the_deadline(self):
        httpd = self.start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        started = time.monotonic()
        with socket.create_connection(("127.0.0.1", httpd.server_address[1])) as sock:
            while time.monotonic() - started < 6:
                try:
                    sock.sendall(b"X")  # a byte every 0.2 s: each read succeeds, so only a deadline can stop it
                    sock.settimeout(0.2)
                    if sock.recv(1) == b"":
                        break
                except socket.timeout:
                    continue
                except OSError:
                    break
        self.assertLess(time.monotonic() - started, 3, "the dripping connection was never closed")

    def test_a_dripping_client_cannot_stall_shutdown(self):
        httpd = self.start()
        sock = socket.create_connection(("127.0.0.1", httpd.server_address[1]))
        self.addCleanup(sock.close)
        stop = threading.Event()

        def drip():
            while not stop.is_set():
                try:
                    sock.sendall(b"X")
                except OSError:
                    return
                time.sleep(0.2)

        threading.Thread(target=drip, daemon=True).start()
        self.addCleanup(stop.set)
        time.sleep(0.3)
        httpd.shutdown()
        closer = threading.Thread(target=httpd.server_close, daemon=True)  # joined with a timeout: it can block
        started = time.monotonic()
        closer.start()
        closer.join(2.0)
        self.assertFalse(closer.is_alive(), "server_close is still waiting for the dripping client")
        self.assertLess(time.monotonic() - started, 2.0)


class ConnectionLimitTests(ServerTestCase):
    def open_idle(self, base, count):
        port = int(base.rsplit(":", 1)[1])
        socks = [socket.create_connection(("127.0.0.1", port)) for _ in range(count)]
        for sock in socks:
            self.addCleanup(sock.close)
        time.sleep(0.2)  # let the accept loop take them, in order, before anything else connects
        return socks

    def test_constants_are_the_spec_values(self):
        self.assertEqual(server.MAX_CONNECTIONS, 64)
        self.assertEqual(server.REQUEST_TIMEOUT, 15)
        self.assertEqual(Handler.timeout, 15)

    def test_request_threads_are_not_daemons_so_shutdown_waits_for_them(self):
        httpd = make_server(Config(), port=0)
        self.addCleanup(httpd.server_close)
        self.assertIs(httpd.daemon_threads, False)

    def test_connections_over_the_cap_get_503_and_capacity_returns_when_one_closes(self):
        base = self.serve(Config(), max_connections=2)
        idle = self.open_idle(base, 2)
        status, headers, body = call(base, "/api/health")
        self.assertEqual(status, 503)
        self.assertGreaterEqual(int(headers["Retry-After"]), 1)
        self.assertIn("error", json.loads(body))
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        idle[0].close()
        self.assertTrue(wait_for(lambda: call(base, "/api/health")[0] == 200))

    def test_a_refused_client_that_sends_its_request_late_still_reads_the_503(self):
        """Review finding 9 (observed as an intermittent failure): if the server closes right after refusing, the
        client's late request bytes trigger a reset that discards the 503."""
        httpd, base = start(Config(), max_connections=1)
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        port = int(base.rsplit(":", 1)[1])
        self.open_idle(base, 1)  # takes the only slot
        with socket.create_connection(("127.0.0.1", port)) as late:
            time.sleep(0.4)  # by now the server has refused us
            late.sendall(b"GET /api/health HTTP/1.0\r\n\r\n")
            late.settimeout(3)
            data = b""
            while chunk := late.recv(4096):
                data += chunk
        self.assertTrue(data.startswith(b"HTTP/1.1 503"), data[:60])
        self.assertTrue(wait_for(lambda: len(httpd._lingering) == 0, 5), "refused sockets were never closed")

    def test_capacity_is_released_after_a_malformed_request(self):
        base = self.serve(Config(), max_connections=1)
        port = int(base.rsplit(":", 1)[1])
        with socket.create_connection(("127.0.0.1", port)) as sock:
            sock.sendall(b"\x00\x01 not http\r\n\r\n")
            sock.settimeout(3)
            while sock.recv(4096):
                pass
        self.assertTrue(wait_for(lambda: call(base, "/api/health")[0] == 200))

    def test_a_client_that_stalls_mid_request_is_disconnected(self):
        class Quick(Handler):
            timeout = 0.5

        httpd = HardenedServer(("127.0.0.1", 0), Quick, Config())
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        with socket.create_connection(("127.0.0.1", httpd.server_address[1])) as sock:
            sock.sendall(b"GET /api/he")  # never finishes the request line
            sock.settimeout(3)
            self.assertEqual(sock.recv(1024), b"")  # the server gave up and closed


if __name__ == "__main__":
    unittest.main()
