"""Shared helpers for the server tests: start a real HardenedServer on an ephemeral port and call it."""

import dataclasses
import json
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid

from xss_detector import config as settings
from xss_detector.server import make_server


def start(config, **kwargs):
    """Each test server gets its own scan-history file, inside the temporary directory tests/__init__.py made."""
    if not config.scan_db:
        config = dataclasses.replace(config, scan_db=str(settings.DEFAULT_SCAN_DB.parent / f"{uuid.uuid4().hex}.db"))
    httpd = make_server(config, port=0, **kwargs)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def call(base, path, body=None, headers=None):
    """Returns (status, headers, body bytes) without raising on HTTP errors."""
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    request = urllib.request.Request(base + path, data=data, headers=headers or {}, method="GET" if data is None else "POST")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request) as resp:
            return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.headers, err.read()


def wait_for(predicate, seconds=3.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


class ServerTestCase(unittest.TestCase):
    def serve_httpd(self, config, **kwargs):
        """Like serve(), but also returns the server object, for tests that look inside it."""
        httpd, base = start(config, **kwargs)
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        return httpd, base

    def serve(self, config, **kwargs):
        return self.serve_httpd(config, **kwargs)[1]
