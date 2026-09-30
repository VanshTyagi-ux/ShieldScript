"""Zero-dependency HTTP server: the site (a React app) + a JSON API.

  GET  /, /scanner, /how-it-works, /rules, /benchmarks, /api-docs, /about   the app shell (unknown pages: shell, 404)
  GET  /app.js /favicon.svg
  GET  /api/health /api/rules /api/benchmark
  POST /api/scan      {"text": "..."}  or  {"fields": {"name": "..."}}
  POST /api/submit    {"fields": {"name","email","website","comment"}} -> 200 accepted / 422 rejected
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import math
import re
import signal
import socket
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Mapping

from . import catalog
from .config import DEFAULT_CONFIG, Config, live_feed_enabled
from .events import EventLog
from .logs import configure_logging
from .ml import HybridDetector
from .ratelimit import TokenBucketLimiter, client_ip
from .submit import review_submission

STATIC = Path(__file__).parent / "static"  # holds only the built React bundle, app.js
BENCHMARK_PATH = Path(__file__).resolve().parent.parent / "reports" / "benchmark.json"
# Client-side routes: these serve the app with 200. Any other extension-less non-API path serves it with 404.
PAGES = ("/", "/scanner", "/live", "/how-it-works", "/rules", "/benchmarks", "/api-docs", "/about")
DESCRIPTION = ("Detect cross-site scripting in user input: decoding-aware rules plus an ML second opinion, "
               "benchmarked honestly.")
FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<path d="M32 4 8 13v17c0 15 10 26 24 30 14-4 24-15 24-30V13L32 4z" fill="#0057ff"/>'
    '<path d="m22 32 7 7 14-15" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
    "</svg>"
).encode("utf-8")
# The page shell is generated here so no .html file ships; React renders everything into #root.
SHELL_HTML = (
    '<!doctype html>\n<html lang="en">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    "<title>XSS Detector</title>\n"
    f'<meta name="description" content="{DESCRIPTION}">\n'
    '<meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)">\n'
    '<meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)">\n'
    '<meta property="og:title" content="XSS Detector">\n'
    f'<meta property="og:description" content="{DESCRIPTION}">\n'
    '<meta property="og:type" content="website">\n'
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
    "</head>\n<body>\n"
    "<noscript>This page needs JavaScript.</noscript>\n"
    # React replaces the contents of #root on mount, so this only stays visible if app.js never loads.
    '<div id="root"><p>Loading the XSS Detector UI... If this message stays, the frontend bundle is '
    'missing: run "npm run build" in frontend/.</p></div>\n'
    '<script src="/app.js"></script>\n</body>\n</html>\n'
).encode("utf-8")
MAX_BODY = DEFAULT_CONFIG.max_body  # the default; the running server uses Config.max_body
DRAIN_FACTOR = 4  # we read up to this many times max_body of a rejected request, just to answer cleanly
MAX_CONNECTIONS = 64  # concurrent connections served; more get 503 + Retry-After
REQUEST_TIMEOUT = 15  # seconds a client may stall on one socket read before we drop it
LINGER_SECONDS = 2.0  # how long a refused (503) connection may stay open so the client can read the reply
MAX_LINGERING = 256  # refused connections held at once; beyond this they are closed immediately
REQUEST_ID_RE =re.compile(r"[A-Za-z0-9._-]{1,64}")  # an incoming X-Request-Id is only echoed if it matches
SOURCE_RE = re.compile(r"[a-z0-9-]{1,40}")  # the "source" a scan request may name itself with (recorded for /live)
# What one /api request costs the rate limiter; any other /api route (a 404) costs 1. /api/health is exempt.
API_COSTS = {("GET", "/api/rules"): 0.25, ("GET", "/api/benchmark"): 0.25, ("GET", "/api/events"): 0.25,
             ("POST", "/api/scan"): 1.0, ("POST", "/api/submit"): 1.0}
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
}
HSTS = "max-age=31536000; includeSubDomains"

log = logging.getLogger("xss_detector.server")
detector = HybridDetector()  # rules + ML (ML is skipped if model.json is missing)


@dataclass(frozen=True)
class Bundle:
    """The built frontend: the file, its gzip form, and one strong ETag per encoding."""
    raw: bytes
    gz: bytes
    etag: str
    etag_gzip: str


_bundle_cache: tuple[tuple, Bundle] | None = None
_bundle_lock = threading.Lock()


def load_bundle() -> Bundle | None:
    """The bundle, or None if it is missing. Compressed and hashed once per file version: the cache is keyed
    on (path, mtime, size), so a rebuilt file (npm run dev, a redeploy) is picked up on the next request."""
    global _bundle_cache
    path = STATIC / "app.js"  # STATIC is read per call so tests can point it elsewhere
    try:
        stat = path.stat()
    except OSError:
        return None
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    with _bundle_lock:
        if _bundle_cache is not None and _bundle_cache[0] == key:
            return _bundle_cache[1]
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()[:32]
        bundle = Bundle(raw, gzip.compress(raw, 6, mtime=0), f'"{digest}"', f'"{digest}-gzip"')
        _bundle_cache = (key, bundle)
        return bundle


def accepts_gzip(header: str) -> bool:
    """True if an Accept-Encoding header lists gzip with a non-zero weight."""
    for part in header.split(","):
        coding, _, params = part.strip().partition(";")
        if coding.strip().lower() != "gzip":
            continue
        weight = re.search(r"q\s*=\s*([0-9.]+)", params)
        try:
            return float(weight.group(1)) > 0 if weight else True
        except ValueError:
            return False
    return False


def check_bundle() -> bool:
    """True if the built frontend (static/app.js) exists; otherwise log how to build it."""
    present = (STATIC / "app.js").is_file()
    if not present:
        log.warning('frontend bundle missing: run "npm run build" in frontend/')
    return present


def security_headers(config: Config) -> dict[str, str]:
    """Headers for every response; HSTS only when enabled (it is only right once HTTPS is confirmed)."""
    return {**SECURITY_HEADERS, "Strict-Transport-Security": HSTS} if config.enable_hsts else dict(SECURITY_HEADERS)


def health_payload() -> dict:
    """`bundle` is False when the frontend was never built; the route answers 503 then, so a platform's health
    check keeps a broken deploy out of rotation."""
    bundle = (STATIC / "app.js").is_file()
    return {"status": "ok" if bundle else "degraded", "rules": len(detector.rules.rules),
            "ml_loaded": detector.ml is not None, "bundle": bundle}


def rules_payload() -> dict:
    """The rule catalog: every pattern rule, then the derived obfuscation rule, plus the level bands."""
    return catalog.rules_payload(detector.rules.block_threshold)


class BadRequest(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class HardenedServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that carries the settings and the rate limiter the Handler reads, and refuses
    connections beyond `max_connections` with a 503 instead of spawning unbounded threads.

    Request threads are non-daemon, so server_close() waits for requests already in flight; the handler
    timeout (REQUEST_TIMEOUT) bounds that wait."""

    daemon_threads = False
    block_on_close = True

    def __init__(self, address: tuple[str, int], handler_class: type[BaseHTTPRequestHandler], config: Config,
                 max_connections: int = MAX_CONNECTIONS):
        self.config = config
        self.limiter = TokenBucketLimiter(config.rate_limit, config.rate_burst)
        self.events = EventLog()
        self.live_feed = live_feed_enabled(config, address[0])  # the bound host, not the config: flags can override it
        self._slots = threading.BoundedSemaphore(max_connections)
        self._deadline = getattr(handler_class, "deadline", REQUEST_TIMEOUT)
        self._open: dict[socket.socket, float] = {}  # connection -> monotonic time by which it must be done
        self._lingering: dict[socket.socket, float] = {}  # refused connections -> when to close them
        self._open_lock = threading.Lock()
        self._watchdog_stop = threading.Event()
        super().__init__(address, handler_class)
        threading.Thread(target=self._watch, name="deadline-watchdog", daemon=True).start()

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            self._refuse(request, client_address)
            return
        self._track(request, add=True)
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._track(request, add=False)
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._track(request, add=False)
            self._slots.release()

    def _track(self, request, add: bool) -> None:
        with self._open_lock:
            if add:
                self._open[request] = time.monotonic() + self._deadline
            else:
                self._open.pop(request, None)

    def _watch(self) -> None:
        """Enforce a deadline on the whole request. The handler's socket timeout only limits each read, so a
        client sending one byte every few seconds would otherwise hold a connection slot (and block shutdown)
        forever. Shutting the socket down makes the blocked read return and the handler thread end."""
        interval = max(0.05, min(1.0, self._deadline / 4))
        while not self._watchdog_stop.wait(interval):
            now = time.monotonic()
            with self._open_lock:
                expired = [sock for sock, due in self._open.items() if due <= now]
            for sock in expired:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass  # already closed
            self._drain_lingering(now)

    def _drain_lingering(self, now: float) -> None:
        """Read and discard whatever refused clients sent; close each once it hangs up or its time is up."""
        with self._open_lock:
            waiting = list(self._lingering.items())
        for sock, due in waiting:
            done = due <= now
            if not done:
                try:
                    done = sock.recv(65536) == b""
                except BlockingIOError:
                    pass  # nothing to read yet
                except OSError:
                    done = True
            if done:
                with self._open_lock:
                    self._lingering.pop(sock, None)
                self.shutdown_request(sock)

    def server_close(self):
        try:
            super().server_close()  # waits for in-flight requests; the watchdog is what bounds that wait
        finally:
            self._watchdog_stop.set()
            with self._open_lock:
                leftovers, self._lingering = list(self._lingering), {}
            for sock in leftovers:
                self.shutdown_request(sock)

    def handle_error(self, request, client_address):
        """One log record instead of the default traceback on stderr (which would not be JSON). A client that
        went away or stalled is expected traffic, not an error."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, TimeoutError)):
            log.debug("client %s dropped the connection: %s", client_address[0], exc)
            return
        log.error("unhandled error serving %s", client_address[0], exc_info=True)

    def _refuse(self, request, client_address) -> None:
        """Answer 503 from the accept loop without spending a thread."""
        request_id = uuid.uuid4().hex
        log.info("- - -> 503 (refused: too many connections)",
                 extra={"method": "-", "path": "-", "status": 503, "duration_ms": 0.0,
                        "client": client_address[0], "request_id": request_id})
        body = json.dumps({"error": "Server busy; retry shortly"}).encode()
        head = ["HTTP/1.1 503 Service Unavailable", "Content-Type: application/json",
                f"Content-Length: {len(body)}", "Retry-After: 1", "Connection: close",
                f"X-Request-Id: {request_id}"]
        head += [f"{key}: {value}" for key, value in security_headers(self.config).items()]
        try:
            request.sendall(("\r\n".join(head) + "\r\n\r\n").encode("ascii") + body)
            request.shutdown(socket.SHUT_WR)  # the client reads the 503, then EOF
        except OSError:
            self.shutdown_request(request)
            return
        # Closing now could reset the connection: the client's request bytes may not have arrived yet, and a
        # reset discards the 503 it has not read. So keep the socket open, drained by _watch, until the client
        # closes or LINGER_SECONDS pass. The table is bounded; past that we just close.
        with self._open_lock:
            if len(self._lingering) < MAX_LINGERING:
                request.setblocking(False)
                self._lingering[request] = time.monotonic() + LINGER_SECONDS
                return
        self.shutdown_request(request)


class Handler(BaseHTTPRequestHandler):
    server_version = "XSSDetector/1.0"
    timeout = REQUEST_TIMEOUT   # applied to the socket: the longest one read may block
    deadline = REQUEST_TIMEOUT  # the longest a whole request may take; enforced by HardenedServer._watch

    # -- plumbing ---------------------------------------------------------------
    @property
    def cfg(self) -> Config:
        """Settings of the server running this handler; a plain ThreadingHTTPServer gets the defaults."""
        return getattr(self.server, "config", DEFAULT_CONFIG)

    def _client(self) -> str:
        # Repeated header lines are one comma-separated list (RFC 9110 5.3); a proxy may append its own line.
        forwarded = ", ".join(self.headers.get_all("X-Forwarded-For") or []) or None
        return client_ip(self.client_address[0], forwarded, self.cfg.trusted_proxy_hops)

    def parse_request(self):
        self._started = time.perf_counter()  # after the request line arrived: idle waiting is not "duration"
        self._rid = None
        return super().parse_request()

    def _request_id(self) -> str:
        """The client's X-Request-Id if it is a plain token, else a fresh one. Never echo anything else:
        a folded header could otherwise carry CR/LF into our response headers."""
        if getattr(self, "_rid", None) is None:
            given = self.headers.get("X-Request-Id") if hasattr(self, "headers") else None
            self._rid = given if given and REQUEST_ID_RE.fullmatch(given) else uuid.uuid4().hex
        return self._rid

    def end_headers(self):
        self.send_header("X-Request-Id", self._request_id())
        super().end_headers()

    def log_request(self, code="-", size="-"):
        """One structured record per response (send_response and send_error both call this). Only the route
        is logged, never the query string or body: both can carry user input."""
        try:
            status = int(code)
        except (TypeError, ValueError):
            status = 0
        method = getattr(self, "command", None) or "-"
        route = getattr(self, "path", "-").split("?", 1)[0]
        try:
            client = self._client()
        except AttributeError:  # the request line was malformed, so there are no headers to consult
            client = self.client_address[0]
        duration_ms = round((time.perf_counter() - getattr(self, "_started", time.perf_counter())) * 1000, 2)
        log.info("%s %s -> %s (%.1f ms)", method, route, status, duration_ms,
                 extra={"method": method, "path": route, "status": status, "duration_ms": duration_ms,
                        "client": client, "request_id": self._request_id()})

    def _limited(self, cost: float) -> bool:
        """Charge this client `cost`; if it is over the limit, answer 429 and return True.
        A server without a limiter (the plain ThreadingHTTPServer used by older tests) never limits."""
        limiter = getattr(self.server, "limiter", None)
        if limiter is None:
            return False
        allowed, retry_after = limiter.allow(self._client(), cost)
        if allowed:
            return False
        if self.command == "POST":  # unread body data would turn our 429 into a connection reset
            self._drain_body()
        wait = max(1, math.ceil(retry_after))
        self._json(429, {"error": f"Rate limit exceeded; retry in {wait} s"}, {"Retry-After": str(wait)})
        return True

    def _send(self, status: int, body: bytes, content_type: str, extra_headers: Mapping[str, str] | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in {**security_headers(self.cfg), **(extra_headers or {})}.items():  # extras may override
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict, extra_headers: Mapping[str, str] | None = None):
        self._send(status, json.dumps(payload).encode(), "application/json", extra_headers)

    def _drain_body(self) -> None:
        """Drop the request body, if it declares a length, so a reply sent without reading it is not reset."""
        try:
            self._discard(int(self.headers.get("Content-Length", "")))
        except ValueError:
            pass

    def _discard(self, length: int) -> None:
        """Read and drop a rejected body (up to DRAIN_FACTOR x max_body). Closing the socket with unread data
        resets the connection, and the client then sees a network error instead of our 413/429."""
        remaining = min(max(length, 0), DRAIN_FACTOR * self.cfg.max_body)
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise BadRequest(411, "Content-Length header required")
        if length < 0 or length > self.cfg.max_body:
            self._discard(length)
            raise BadRequest(413, f"Body must be at most {self.cfg.max_body} bytes")
        try:
            data = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError, RecursionError):  # RecursionError: "[" * 200000 nests too deep
            raise BadRequest(400, "Body must be valid JSON")
        if not isinstance(data, dict):
            raise BadRequest(400, "Body must be a JSON object")
        return data

    @staticmethod
    def _fields(data: dict) -> dict[str, str]:
        fields = data.get("fields")
        if not isinstance(fields, dict) or not all(isinstance(v, str) for v in fields.values()):
            raise BadRequest(400, "'fields' must be an object of strings")
        return fields

    # -- routes -----------------------------------------------------------------
    def _benchmark(self):
        try:
            body = BENCHMARK_PATH.read_bytes()
        except FileNotFoundError:
            return self._json(404, {"error": "Benchmark not generated; run python -m xss_detector evaluate"})
        except OSError:
            return self._json(500, {"error": "Benchmark file is unreadable"})
        try:
            json.loads(body)
        except ValueError:
            return self._json(500, {"error": "Benchmark file is unreadable"})
        self._send(200, body, "application/json")

    def _serve_bundle(self):
        bundle = load_bundle()
        if bundle is None:
            return self._json(404, {"error": "Frontend bundle not built; run npm run build in frontend/"})
        gzipped = accepts_gzip(self.headers.get("Accept-Encoding", ""))
        body, etag = (bundle.gz, bundle.etag_gzip) if gzipped else (bundle.raw, bundle.etag)
        headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
        if gzipped:
            headers["Content-Encoding"] = "gzip"
        wanted = {tag.strip().removeprefix("W/") for tag in self.headers.get("If-None-Match", "").split(",")}
        if etag in wanted or "*" in wanted:
            return self._send(304, b"", "text/javascript; charset=utf-8", headers)
        self._send(200, body, "text/javascript; charset=utf-8", headers)

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if len(route) > 1 and route.endswith("/"):
            route = route.rstrip("/") or "/"
        if route.startswith("/api/") and route != "/api/health" and self._limited(API_COSTS.get(("GET", route), 1.0)):
            return
        if route == "/app.js":
            return self._serve_bundle()
        if route == "/favicon.svg":
            return self._send(200, FAVICON_SVG, "image/svg+xml")
        if route == "/api/health":
            payload = health_payload()
            return self._json(200 if payload["bundle"] else 503, payload)
        if route == "/api/rules":
            return self._json(200, rules_payload())
        if route == "/api/benchmark":
            return self._benchmark()
        if route == "/api/events":
            return self._json(200, {"events": self._events(), "enabled": self._live_feed()})
        if route in PAGES:
            return self._send(200, SHELL_HTML, "text/html; charset=utf-8")
        if not route.startswith("/api/") and "." not in route.rsplit("/", 1)[-1]:
            return self._send(404, SHELL_HTML, "text/html; charset=utf-8")  # the app renders its 404 page
        self._json(404, {"error": "Not found"})

    def do_POST(self):
        route = self.path.split("?", 1)[0]
        if route.startswith("/api/") and self._limited(API_COSTS.get(("POST", route), 1.0)):
            return
        if route not in ("/api/scan", "/api/submit"):  # nothing else takes a body, so never parse one
            self._drain_body()
            return self._json(404, {"error": "Not found"})
        try:
            data = self._read_json()
            if route == "/api/scan":
                return self._json(200, self._scan(data))
            if route == "/api/submit":
                status, payload = self._submit(self._fields(data))
                return self._json(status, payload)
            self._json(404, {"error": "Not found"})
        except BadRequest as exc:
            self._json(exc.status, {"error": exc.message})

    def _live_feed(self) -> bool:
        return getattr(self.server, "live_feed", False)

    def _events(self) -> list[dict]:
        events = getattr(self.server, "events", None)
        return events.snapshot() if events is not None and self._live_feed() else []

    @staticmethod
    def _source(data: dict) -> str | None:
        """The optional 'source' naming the app that sent this scan; None when absent."""
        if "source" not in data:
            return None
        source = data["source"]
        if not isinstance(source, str) or not SOURCE_RE.fullmatch(source):
            raise BadRequest(400, "'source' must be 1-40 lowercase letters, digits or hyphens")
        return source

    def _record(self, source: str | None, scanned: Mapping[str, tuple[str, dict]]) -> None:
        """Log one event per scanned field (name -> (text, result)) when the caller named a source."""
        if source is None or not self._live_feed():
            return
        for name, (text, result) in scanned.items():
            self.server.events.add(source=source, field=name, blocked=result["is_malicious"], score=result["score"],
                                   level=result["level"], rules=[f["rule_id"] for f in result["findings"]],
                                   text=text)

    def _scan(self, data: dict) -> dict:
        source = self._source(data)  # validated before anything is scanned
        if "fields" in data:
            fields = self._fields(data)
            scanned = {name: (value, detector.scan(value)) for name, value in fields.items()}
            self._record(source, scanned)
            return {"results": {name: result for name, (_, result) in scanned.items()}}
        text = data.get("text")
        if not isinstance(text, str):
            raise BadRequest(400, "Provide 'text' (string) or 'fields' (object)")
        result = detector.scan(text)
        self._record(source, {"text": (text, result)})
        return result

    def _submit(self, fields: dict[str, str]) -> tuple[int, dict]:
        return review_submission(detector, fields)

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)


def make_server(config: Config, host: str | None = None, port: int | None = None,
                max_connections: int = MAX_CONNECTIONS) -> HardenedServer:
    """Bind a server for `config`; host/port arguments override the config (tests pass port=0)."""
    address = (config.host if host is None else host, config.port if port is None else port)
    return HardenedServer(address, Handler, config, max_connections)


def serve(host: str | None = None, port: int | None = None, config: Config | None = None) -> None:
    config = Config.from_env() if config is None else config
    configure_logging(config)
    check_bundle()
    httpd = make_server(config, host, port)
    install_shutdown_handlers(httpd)
    bound_host, bound_port = httpd.server_address[:2]
    log.info("Serving on http://%s:%d  (Ctrl+C to stop)", bound_host, bound_port)
    run_server(httpd)


def install_shutdown_handlers(httpd: HardenedServer) -> None:
    """Make SIGTERM (what a PaaS sends on redeploy) and Ctrl+C stop the server gracefully. shutdown() blocks
    until serve_forever() returns, and the signal handler runs on the thread that is inside serve_forever(),
    so calling it inline would deadlock: it runs on a helper thread instead. Signals after the first are no-ops."""
    started = threading.Event()

    def handler(signum, frame):
        if not started.is_set():
            started.set()
            log.info("Received signal %s; shutting down", signal.Signals(signum).name)
            threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


def run_server(httpd: HardenedServer) -> None:
    """Serve until shutdown() is called, then wait for in-flight requests (server_close joins their threads;
    each is bounded by REQUEST_TIMEOUT) before returning."""
    try:
        httpd.serve_forever()
    finally:
        log.info("Waiting for in-flight requests")
        httpd.server_close()
        log.info("Stopped")
