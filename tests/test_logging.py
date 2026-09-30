import json
import logging
import re
import socket
import time
import unittest

from tests.helpers import ServerTestCase, call
from xss_detector.config import Config
from xss_detector.logs import JsonFormatter, configure_logging

LOGGER = "xss_detector.server"
KEYS = ("method", "path", "status", "duration_ms", "client", "request_id")


def request_records(cm):
    return [r for r in cm.records if hasattr(r, "request_id")]


class RequestLogTests(ServerTestCase):
    def test_one_structured_record_per_request(self):
        base = self.serve(Config())
        with self.assertLogs(LOGGER, "INFO") as cm:
            _, headers, _ = call(base, "/api/health")
        records = request_records(cm)
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual((record.method, record.path, record.status), ("GET", "/api/health", 200))
        self.assertGreaterEqual(record.duration_ms, 0)
        self.assertEqual(record.client, "127.0.0.1")
        self.assertEqual(record.request_id, headers["X-Request-Id"])

    def test_request_bodies_and_query_strings_are_never_logged(self):
        base = self.serve(Config())
        with self.assertLogs(LOGGER, "INFO") as cm:
            call(base, "/api/scan", {"text": "SECRET-BODY-MARKER <script>"})
            call(base, "/scanner?text=SECRET-QUERY-MARKER")
        everything = "\n".join(cm.output) + "\n".join(str(r.__dict__) for r in cm.records)
        self.assertNotIn("SECRET-BODY-MARKER", everything)
        self.assertNotIn("SECRET-QUERY-MARKER", everything)
        self.assertIn("/scanner", [r.path for r in request_records(cm)])

    def test_a_valid_incoming_request_id_is_echoed(self):
        base = self.serve(Config())
        with self.assertLogs(LOGGER, "INFO") as cm:
            _, headers, _ = call(base, "/api/health", headers={"X-Request-Id": "abc-123.X_y"})
        self.assertEqual(headers["X-Request-Id"], "abc-123.X_y")
        self.assertEqual(request_records(cm)[0].request_id, "abc-123.X_y")

    def test_an_invalid_request_id_is_replaced_never_echoed(self):
        base = self.serve(Config())
        for bad in ("a" * 65, "bad id", "semi;colon", ""):
            with self.subTest(bad=bad):
                _, headers, _ = call(base, "/api/health", headers={"X-Request-Id": bad})
                self.assertRegex(headers["X-Request-Id"], r"^[0-9a-f]{32}$")

    def test_a_folded_header_cannot_inject_a_response_header(self):
        base = self.serve(Config())
        port = int(base.rsplit(":", 1)[1])
        request = b"GET /api/health HTTP/1.0\r\nX-Request-Id: abc\r\n Set-Cookie: injected=1\r\n\r\n"
        with socket.create_connection(("127.0.0.1", port)) as sock:
            sock.sendall(request)
            sock.settimeout(3)
            raw = b""
            while chunk := sock.recv(4096):
                raw += chunk
        head = raw.split(b"\r\n\r\n", 1)[0].decode("latin-1")
        self.assertNotIn("Set-Cookie", head)
        self.assertRegex(head, r"X-Request-Id: [0-9a-f]{32}\r?\n?")

    def test_a_429_is_logged_with_the_forwarded_client(self):
        base = self.serve(Config(rate_limit=1, rate_burst=1, trusted_proxy_hops=1))
        with self.assertLogs(LOGGER, "INFO") as cm:
            call(base, "/api/scan", {"text": "a"}, {"X-Forwarded-For": "evil, 5.5.5.5"})
            call(base, "/api/scan", {"text": "a"}, {"X-Forwarded-For": "evil, 5.5.5.5"})
        records = request_records(cm)
        self.assertEqual([r.status for r in records], [200, 429])
        self.assertEqual({r.client for r in records}, {"5.5.5.5"})

    def test_a_refused_connection_is_logged_as_503(self):
        base = self.serve(Config(), max_connections=1)
        port = int(base.rsplit(":", 1)[1])
        idle = socket.create_connection(("127.0.0.1", port))
        self.addCleanup(idle.close)
        time.sleep(0.2)
        with self.assertLogs(LOGGER, "INFO") as cm:
            status, _, _ = call(base, "/api/health")
        self.assertEqual(status, 503)
        self.assertIn(503, [r.status for r in request_records(cm)])


class JsonFormatterTests(unittest.TestCase):
    def record(self, msg="hello", **extra):
        record = logging.LogRecord("xss_detector.server", logging.INFO, __file__, 1, msg, None, None)
        for key, value in extra.items():
            setattr(record, key, value)
        return record

    def test_a_request_record_becomes_one_json_object(self):
        line = JsonFormatter().format(self.record("GET /x", method="GET", path="/x", status=200, duration_ms=1.5,
                                                  client="1.2.3.4", request_id="abc"))
        data = json.loads(line)
        for key in ("ts", "level", "msg") + KEYS:
            self.assertIn(key, data)
        self.assertEqual((data["level"], data["status"], data["client"]), ("INFO", 200, "1.2.3.4"))
        self.assertNotIn("\n", line)

    def test_a_plain_record_has_only_ts_level_and_msg(self):
        self.assertEqual(set(json.loads(JsonFormatter().format(self.record()))), {"ts", "level", "msg"})

    def test_values_that_are_not_json_do_not_raise(self):
        line = JsonFormatter().format(self.record(request_id=object()))
        self.assertIn("request_id", json.loads(line))


class ConfigureLoggingTests(unittest.TestCase):
    def setUp(self):
        self.root = logging.getLogger()
        self.saved = (self.root.handlers[:], self.root.level)
        self.addCleanup(self.restore)

    def restore(self):
        self.root.handlers[:] = self.saved[0]
        self.root.setLevel(self.saved[1])

    def test_json_format_and_level_are_applied(self):
        configure_logging(Config(log_format="json", log_level="WARNING"))
        self.assertEqual(self.root.level, logging.WARNING)
        self.assertEqual(len(self.root.handlers), 1)
        self.assertIsInstance(self.root.handlers[0].formatter, JsonFormatter)

    def test_text_format_is_the_default_and_calling_twice_does_not_duplicate_output(self):
        configure_logging(Config())
        configure_logging(Config())
        self.assertEqual(len(self.root.handlers), 1)
        self.assertNotIsInstance(self.root.handlers[0].formatter, JsonFormatter)
        self.assertEqual(self.root.level, logging.INFO)


if __name__ == "__main__":
    unittest.main()
