# Production Deployment Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the XSS Detector safe to host publicly on a PaaS: env-driven config, per-client rate limiting, connection and timeout limits, structured logs, caching, graceful shutdown, a Docker image, and CI.

**Architecture:** The stdlib `ThreadingHTTPServer` + `Handler` in `xss_detector/server.py` is kept. New small modules (`config.py`, `ratelimit.py`, `logs.py`) are wired in through a `HardenedServer` subclass that carries the config and limiter; the existing `Handler` reads them from `self.server` and falls back to defaults, so the existing tests, which build a plain `ThreadingHTTPServer(("127.0.0.1", 0), Handler)`, keep working unchanged. The detector, API shapes and React UI do not change.

**Tech Stack:** Python 3.12 stdlib only (`unittest`, `ipaddress`, `gzip`, `hashlib`, `signal`, `threading`, `logging`); Docker; GitHub Actions; Render blueprint.

**Spec:** `docs/superpowers/specs/2026-09-28-production-deployment-design.md`

## Global Constraints

- Runtime stays **stdlib-only** (no pip dependencies). Python 3.12.
- Detector, API request/response shapes, React source and the CSP string (`default-src 'self'; frame-ancestors 'none'`) are **not changed**.
- Config env vars and defaults (spec section 3): `HOST` `127.0.0.1`; `PORT` `8000`; `LOG_LEVEL` `INFO`; `LOG_FORMAT` `text` (or `json`); `MAX_BODY` `262144`; `RATE_LIMIT` `60` per minute per client; `RATE_BURST` `20`; `TRUSTED_PROXY_HOPS` `0`; `ENABLE_HSTS` off. Invalid values fail at start-up with a clear message. CLI flags override env.
- Rate limit applies to every `/api/*` request; `POST /api/scan` and `POST /api/submit` cost `1`, `GET /api/rules` and `GET /api/benchmark` cost `0.25`. **Exempt:** the HTML shell, `/app.js`, `/favicon.svg`, `/api/health`.
- Over the limit: `429`, `Retry-After` header, `{"error": ...}` body. Limiter table capped (4096 clients), oldest idle evicted.
- Fixed constants (not env vars): handler timeout `15` s, max concurrent connections `64` (excess get `503` + `Retry-After`).
- `/api/health` gains `bundle: bool` and returns `503` when the bundle is missing. Never rate limited.
- Never log request bodies **or query strings** (route only). `X-Request-Id` is honoured only if it matches `[A-Za-z0-9._-]{1,64}`.
- Request threads are non-daemon; `SIGTERM` finishes in-flight requests then exits.
- The existing 68 Python tests and 435 frontend tests must stay green. Verify with `python -m unittest discover -s tests -t .` and `npm --prefix frontend test`.
- This folder is **not a git repository**: there are no commit steps. Each task ends with a checkpoint step (tests pass). Turning it into a git repo is a separate step the user must approve (see the handoff note at the end).
- Environment: Windows, PowerShell 7 (`&&` works), Python 3.12, **Docker is not installed locally** (the image build is proven by CI).

## Review Focus

Failure modes the spec implies but does not spell out (each has a test in the named task):

1. A forged `X-Forwarded-For` (`evil, real`) with `TRUSTED_PROXY_HOPS=1` must not let a client dodge or borrow another client's limit (Tasks 2, 3).
2. A `429` on a POST that carries a body must reach the client as JSON, not a connection reset (Task 3); the UI already shows `data.error`, pinned by a frontend test (Task 3).
3. Platform health probes must keep returning `200` while the limiter is exhausted (Task 3).
4. Bad env (`PORT=abc`, `RATE_LIMIT=-5`, `PORT=""`) must fail with one clear line and exit code `2`, not a traceback (Task 1).
5. A `X-Request-Id` containing CR/LF or an over-long value must be replaced, never echoed into a response header (Task 5).

---

## File map

```
xss_detector/config.py        new (Task 1)      Config, ConfigError, DEFAULT_CONFIG
xss_detector/ratelimit.py     new (Task 2)      TokenBucketLimiter, client_ip
xss_detector/logs.py          new (Task 5)      JsonFormatter, configure_logging
xss_detector/server.py        modified          HardenedServer, make_server, limits, logging, caching, headers, health, shutdown
xss_detector/cli.py           modified (Task 1) serve reads Config
tests/test_config.py  test_ratelimit.py  test_hardening.py  test_logging.py  test_caching.py
tests/test_shutdown.py  test_performance.py  test_deploy_files.py  test_deploy_smoke.py     new
frontend/src/hooks/useScan.test.js   modified (Task 3, one test)
Dockerfile  .dockerignore  render.yaml  .gitattributes  .github/workflows/ci.yml  new (Task 10)
README.md                     modified (Task 10)
```

---

### Task 1: Configuration

**Files:**
- Create: `xss_detector/config.py`
- Modify: `xss_detector/cli.py:41-43,77-80` (`cmd_serve`, `serve` parser)
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `class ConfigError(ValueError)`.
- Produces: frozen `@dataclass Config(host: str = "127.0.0.1", port: int = 8000, log_level: str = "INFO", log_format: str = "text", max_body: int = 262144, rate_limit: int = 60, rate_burst: int = 20, trusted_proxy_hops: int = 0, enable_hsts: bool = False)`.
- Produces: `Config.from_env(environ: Mapping[str, str] | None = None) -> Config` (defaults to `os.environ`), and `DEFAULT_CONFIG = Config()`.

- [ ] **Step 1: Write failing tests** in `tests/test_config.py`:
  - empty environ -> `Config.from_env({}) == Config()`.
  - full environ (`HOST=0.0.0.0, PORT=10000, LOG_LEVEL=debug, LOG_FORMAT=json, MAX_BODY=1000, RATE_LIMIT=5, RATE_BURST=2, TRUSTED_PROXY_HOPS=1, ENABLE_HSTS=1`) -> every field set (`log_level == "DEBUG"`, `enable_hsts is True`, ints parsed).
  - `ENABLE_HSTS` accepts `1/true/yes/on` (any case) as true and `0/false/no/off/""` as false; anything else raises.
  - **Review Focus 4:** each of `PORT=abc`, `PORT=""`, `PORT=0`, `PORT=70000`, `RATE_LIMIT=-5`, `RATE_LIMIT=0`, `RATE_BURST=0`, `MAX_BODY=0`, `TRUSTED_PROXY_HOPS=-1`, `LOG_FORMAT=xml`, `LOG_LEVEL=loud` raises `ConfigError` whose message names the variable (`assertIn("PORT", str(err))`).
  - CLI: `run_cli(["serve"], env={"PORT": "abc"})` style test using `subprocess.run([sys.executable, "-m", "xss_detector", "serve"], env=..., capture_output=True)` -> return code `2`, stderr is a single line starting `error:` and contains `PORT`, no `Traceback`.
- [ ] **Step 2: Run** `python -m unittest tests.test_config` -> FAIL (module missing).
- [ ] **Step 3: Implement** `config.py` (one small parse helper per type; ranges: port 1-65535, rate_limit/rate_burst/max_body >= 1, hops >= 0; `log_level` upper-cased and validated with `logging.getLevelName`-style check).
- [ ] **Step 4: Wire the CLI.** `serve` parser: `--host`/`--port` default `None`. `cmd_serve` builds `Config.from_env()`, applies `dataclasses.replace` for any flag given, and on `ConfigError` prints `error: <message>` to stderr and returns `2`. It then calls `serve(config=config)` (signature added in Task 3; until then keep the existing `serve(host, port)` call working with `config.host, config.port`).
- [ ] **Step 5: Checkpoint.** `python -m unittest tests.test_config` PASS, then the full Python suite PASS.

---

### Task 2: Rate limiter and client identity

**Files:**
- Create: `xss_detector/ratelimit.py`
- Test: `tests/test_ratelimit.py`

**Interfaces:**
- Produces: `TokenBucketLimiter(rate_per_minute: float, burst: int, max_clients: int = 4096, clock: Callable[[], float] = time.monotonic)` with `.allow(key: str, cost: float = 1.0) -> tuple[bool, float]` returning `(allowed, retry_after_seconds)`; thread-safe (a `threading.Lock`).
- Produces: `client_ip(peer: str, forwarded_for: str | None, hops: int) -> str`.

- [ ] **Step 1: Write failing tests** with a fake clock:
  - `burst=3, rate=60/min`: three `allow("a")` -> `True`; the fourth -> `(False, r)` with `0 < r <= 1`; after advancing the clock by `r` it is allowed again.
  - refill never exceeds `burst` (advance 1 hour, then only `burst` immediate allows).
  - keys are independent; `cost=0.25` allows 4x as many calls as cost 1; a denied call does **not** consume tokens.
  - eviction: with `max_clients=3`, touching 4 distinct keys keeps the table size `<= 3` and the most recently seen keys are the ones kept; an evicted key restarts with a full bucket.
  - `retry_after` is a float `> 0` and the caller-facing value `math.ceil(...)` is at least `1`.
  - `client_ip` (**Review Focus 1**): `hops=0` ignores the header (`client_ip("9.9.9.9", "1.1.1.1", 0) == "9.9.9.9"`); `hops=1` with `"1.1.1.1, 2.2.2.2"` -> `"2.2.2.2"`; forged prefix `"evil, 2.2.2.2"` with `hops=1` -> `"2.2.2.2"`; `hops=2` with `"1.1.1.1, 2.2.2.2, 3.3.3.3"` -> `"2.2.2.2"`; fewer entries than hops, empty/`None` header, or a non-IP selected entry (`"not-an-ip"`) -> falls back to `peer`; IPv6 accepted; whitespace around entries tolerated.
- [ ] **Step 2: Run** `python -m unittest tests.test_ratelimit` -> FAIL.
- [ ] **Step 3: Implement** both. Token bucket state per key: `(tokens, last_seen)` in an `OrderedDict` used as an LRU (`move_to_end` on touch, `popitem(last=False)` when over `max_clients`). `client_ip` selects `entries[-hops]` after splitting on commas and validates with `ipaddress.ip_address`.
- [ ] **Step 4: Checkpoint.** `python -m unittest tests.test_ratelimit` PASS; full Python suite PASS.

---

### Task 3: Hardened server wiring and rate limiting

**Files:**
- Modify: `xss_detector/server.py` (`serve` at line 228, `do_GET` at 159, `do_POST` at 182, module top)
- Test: `tests/test_hardening.py`, `frontend/src/hooks/useScan.test.js` (one test)

**Interfaces:**
- Consumes: `Config`, `DEFAULT_CONFIG` (Task 1); `TokenBucketLimiter`, `client_ip` (Task 2).
- Produces: `class HardenedServer(ThreadingHTTPServer)`, constructed as `HardenedServer(address: tuple[str, int], handler_class: type[BaseHTTPRequestHandler], config: Config)` (tests in Tasks 4 and 8 pass their own `Handler` subclasses this way), with attributes `config: Config` and `limiter: TokenBucketLimiter` (built from `config.rate_limit`/`config.rate_burst`); `daemon_threads = False`, `block_on_close = True`.
- Produces: `make_server(config: Config, host: str | None = None, port: int | None = None) -> HardenedServer` (tests pass `port=0`).
- Produces: `serve(host: str | None = None, port: int | None = None, config: Config | None = None) -> None` (host/port override config; defaults `Config.from_env()`).
- Produces on `Handler`: a `cfg` property returning `getattr(self.server, "config", DEFAULT_CONFIG)`; `_client() -> str` using `client_ip(self.client_address[0], self.headers.get("X-Forwarded-For"), cfg.trusted_proxy_hops)`; `_limited(cost: float) -> bool` which sends the `429` and returns `True` when over the limit. `MAX_BODY` checks read `self.cfg.max_body`. A plain `ThreadingHTTPServer` (no `limiter` attribute) means "no limiting".

- [ ] **Step 1: Write failing tests** in `tests/test_hardening.py` (helper starts `make_server(Config(rate_limit=60, rate_burst=3), port=0)` in a thread, as `test_frontend.py` does):
  - `POST /api/scan` x3 -> `200`; 4th -> `429` with a `Retry-After` header (integer `>= 1`) and JSON `{"error": <string mentioning "Rate limit">}`; security headers still present.
  - **Review Focus 2:** exhausted bucket, then `POST /api/scan` with a 100 KB body -> the client receives `429` JSON (no `ConnectionResetError`/`URLError`).
  - **Review Focus 3:** exhausted bucket -> `GET /api/health`, `/`, `/scanner`, `/app.js`, `/favicon.svg` still `200`.
  - `GET /api/rules` costs `0.25`: with `burst=3` about 12 succeed before a `429`; `POST /api/submit` costs 1.
  - **Review Focus 1 (end to end):** `TRUSTED_PROXY_HOPS=1`: requests with `X-Forwarded-For: evil-N, 5.5.5.5` (varying the forged first entry) share one bucket and are limited; `X-Forwarded-For: 6.6.6.6` from the same socket gets its own fresh bucket; with `hops=0` the header is ignored (all share the socket bucket).
  - a plain `ThreadingHTTPServer(("127.0.0.1", 0), Handler)` never returns `429` (send 50 scans).
  - `MAX_BODY` from config: `Config(max_body=1000)` -> a 2000-byte POST gets `413`.
  - `serve()` with `port`/`host` arguments overrides config (unit-test `make_server(Config(port=1234), port=0)` binds an ephemeral port).
  - frontend `useScan.test.js`: `post` resolves `{status: 429, ok: false, data: {error: "Rate limit exceeded; retry in 12 s"}}` -> `error === "Rate limit exceeded; retry in 12 s"`.
- [ ] **Step 2: Run** `python -m unittest tests.test_hardening` and `npm --prefix frontend test -- src/hooks/useScan.test.js` -> Python FAIL (the frontend test may already pass, which is fine: it pins existing behaviour).
- [ ] **Step 3: Implement** `HardenedServer`, `make_server`, `serve(host, port, config)`, the `Handler.cfg`/`_client`/`_limited` helpers, and the checks at the top of `do_GET`/`do_POST` for `/api/*` routes other than `/api/health`. On a rejected POST call `self._discard(<Content-Length or 0>)` before sending the `429` (same reason as the 413 path). `Retry-After` is `math.ceil(retry_after)`.
- [ ] **Step 4: Checkpoint.** New tests PASS; full Python and frontend suites PASS.

---

### Task 4: Connection cap and handler timeout

**Files:**
- Modify: `xss_detector/server.py` (`HardenedServer`, `Handler`)
- Test: `tests/test_hardening.py` (new class)

**Interfaces:**
- Produces: module constants `MAX_CONNECTIONS = 64` and `REQUEST_TIMEOUT = 15`; `Handler.timeout = REQUEST_TIMEOUT`; `HardenedServer(address, handler_class, config, max_connections: int = MAX_CONNECTIONS)` holding a `threading.BoundedSemaphore`; `make_server(config, host=None, port=None, max_connections: int = MAX_CONNECTIONS)` passes it through.

- [ ] **Step 1: Write failing tests:**
  - `make_server(Config(), port=0, max_connections=2)`: open 2 raw sockets that connect and send nothing; a third `GET /api/health` gets `503` with `Retry-After`; after closing one of the two, a new request gets `200`.
  - the semaphore is released when a request finishes with an error (send garbage, then confirm capacity returns).
  - slow client: monkeypatch `server.REQUEST_TIMEOUT` is not enough (class attribute is read at import), so the test builds a `Handler` subclass with `timeout = 0.5`, opens a socket, sends a partial request line, and asserts the server closes the connection within 2 s (`recv` returns `b""`).
  - `HardenedServer.daemon_threads is False`.
- [ ] **Step 2: Run** `python -m unittest tests.test_hardening` -> new tests FAIL.
- [ ] **Step 3: Implement** by overriding `process_request(request, client_address)` to `acquire(blocking=False)`; on failure write a minimal raw `HTTP/1.1 503` response (with `Retry-After: 1`, `Content-Length`, JSON body, the security headers) and call `shutdown_request`; on success call `super().process_request`. Override `process_request_thread` to `release()` in a `finally`.
- [ ] **Step 4: Checkpoint.** `python -m unittest tests.test_hardening` PASS; full Python suite PASS.

---

### Task 5: Structured request logging

**Files:**
- Create: `xss_detector/logs.py`
- Modify: `xss_detector/server.py` (`Handler.log_message`, `send_response`, `serve`)
- Test: `tests/test_logging.py`

**Interfaces:**
- Produces: `JsonFormatter(logging.Formatter)` emitting one JSON object per record with keys `ts`, `level`, `msg` plus, when present on the record, `method`, `path`, `status`, `duration_ms`, `client`, `request_id`; `configure_logging(config: Config) -> None` (sets level, chooses `JsonFormatter` or the current text format from `config.log_format`; replaces the `logging.basicConfig` call in `serve`).
- Produces on `Handler`: `_request_id() -> str` (valid incoming `X-Request-Id`, else `uuid.uuid4().hex`); every response carries `X-Request-Id`; one `INFO` record per request on logger `xss_detector.server` with the keys above (the existing `log_message` access line is replaced by it).

- [ ] **Step 1: Write failing tests:**
  - `assertLogs("xss_detector.server", "INFO")` around a `GET /api/health`: exactly one request record with `method == "GET"`, `path == "/api/health"`, `status == 200`, `duration_ms >= 0`, `client == "127.0.0.1"`, and a `request_id` equal to the `X-Request-Id` response header.
  - **Never log input:** `POST /api/scan` with body `{"text": "SECRET-BODY-MARKER"}` and `GET /scanner?text=SECRET-QUERY-MARKER`; joined formatted log output contains neither marker, and the query record's `path == "/scanner"`. (The existing `blocked field=` warning logs rule ids only.)
  - a valid incoming `X-Request-Id: abc-123` is echoed; **Review Focus 5:** `X-Request-Id` values `"a"*65`, `"bad id"`, and one containing `%0d%0a`-decoded CR/LF (send via a raw socket) are replaced by a 32-hex id and never appear in the response headers.
  - `429` and `503` responses are logged with their status; `client` reflects `X-Forwarded-For` under `trusted_proxy_hops=1`.
  - `JsonFormatter`: output for a request record parses with `json.loads` and has the keys above; a plain message record has `ts`, `level`, `msg` only; non-serialisable extras do not raise.
  - `configure_logging(Config(log_format="json", log_level="WARNING"))` sets the root level to WARNING and installs the JSON formatter (assert on the handler, then restore in `tearDown`).
- [ ] **Step 2: Run** `python -m unittest tests.test_logging` -> FAIL.
- [ ] **Step 3: Implement.** Capture the status in an overridden `send_response` and the start time when the request line is parsed; log once per request from the point the response is finished (a `finish`-time or dispatch-wrapper hook is fine; one record per request is the requirement). Suppress `BaseHTTPRequestHandler`'s own `log_request` duplicate by making `log_message` a no-op for access lines but keep it for errors (`log_error`).
- [ ] **Step 4: Checkpoint.** `python -m unittest tests.test_logging` PASS; full Python suite PASS.

---

### Task 6: Bundle caching, ETag, gzip

**Files:**
- Modify: `xss_detector/server.py` (`/app.js` branch of `do_GET`, `_send`)
- Test: `tests/test_caching.py`

**Interfaces:**
- Produces: `class Bundle` (`raw: bytes`, `gz: bytes`, `etag: str`) and `load_bundle() -> Bundle | None` in `server.py`, which reads `STATIC / "app.js"`, and caches keyed by `(st_mtime_ns, st_size)` so a rebuilt file is picked up. `etag` is a quoted strong validator derived from the SHA-256 of `raw`. Reads `STATIC` at call time (existing tests patch `server.STATIC`).
- `_send` gains an optional `extra_headers: Mapping[str, str] | None = None`; `/app.js` uses `Cache-Control: no-cache` instead of `no-store`; the shell and API keep `no-store`.

- [ ] **Step 1: Write failing tests** (patch `server.STATIC` to a temp dir holding a known `app.js`, using the existing `mock.patch("xss_detector.server.STATIC", ...)` style):
  - `GET /app.js` -> `200`, `ETag` present, `Cache-Control: no-cache`, `Content-Type` `text/javascript`, body equals the file, `Vary: Accept-Encoding`.
  - `If-None-Match: <etag>` -> `304`, empty body, `ETag` and the security headers present; a wrong tag -> `200`.
  - `Accept-Encoding: gzip` -> `Content-Encoding: gzip` and `gzip.decompress(body) == raw`, with a different `Content-Length` than identity; without the header -> identity; `Accept-Encoding: gzip;q=0` and `identity` -> identity.
  - **Stale bundle:** rewrite the file with new content (bump mtime) -> next request has a different `ETag` and the new body; a client sending the old `ETag` gets `200`, not `304`.
  - missing bundle -> the existing JSON `404` is unchanged; the shell (`/`) still has `Cache-Control: no-store`.
  - the real bundle: `GET /app.js` against the unpatched server returns an ETag stable across two requests.
- [ ] **Step 2: Run** `python -m unittest tests.test_caching` -> FAIL.
- [ ] **Step 3: Implement** `Bundle`/`load_bundle` (gzip level 6, `mtime=0` so output is deterministic) and the `/app.js` branch handling `If-None-Match` and `Accept-Encoding` (honour `q=0`).
- [ ] **Step 4: Checkpoint.** `python -m unittest tests.test_caching` PASS; full Python suite PASS (the existing frontend-serving tests still pass because `urllib` sends no `Accept-Encoding`).

---

### Task 7: Extra headers and health/readiness

**Files:**
- Modify: `xss_detector/server.py` (`SECURITY_HEADERS` use in `_send`, `health_payload`, the `/api/health` route)
- Test: `tests/test_hardening.py` (new class); adjust nothing in `tests/test_site.py` unless it asserts the health dict by equality (it currently checks keys individually).

**Interfaces:**
- Produces: `SECURITY_HEADERS` gains `"Permissions-Policy": "geolocation=(), camera=(), microphone=()"` and `"Cross-Origin-Opener-Policy": "same-origin"`; the CSP entry is unchanged. `Strict-Transport-Security: max-age=31536000; includeSubDomains` is added by `_send` only when `self.cfg.enable_hsts`.
- Produces: `health_payload() -> dict` now includes `"bundle": bool`; the route returns `503` when `bundle` is false.

- [ ] **Step 1: Write failing tests:**
  - every response type (`/`, `/nope`, `/api/health`, `/api/rules`, a `404`, a `422`, a `429`) carries `Permissions-Policy` and `Cross-Origin-Opener-Policy` and the **unchanged** CSP string.
  - HSTS absent by default; present on all responses with `Config(enable_hsts=True)`.
  - `/api/health` -> `200` with `bundle is True` and the existing keys (`status`, `rules`, `ml_loaded`); with `STATIC` patched to an empty temp dir -> `503`, JSON body with `bundle: false` and `status` not `"ok"`.
  - `GET /api/health` still returns `200` under an exhausted limiter with a healthy bundle (already in Task 3; re-assert `bundle` there).
- [ ] **Step 2: Run** the new tests -> FAIL.
- [ ] **Step 3: Implement** the header additions and the health change. The frontend footer badge treats a non-OK health response as unreachable; confirm with `npm --prefix frontend test` that no fixture needs the new field (`HEALTH_FIXTURE` in `frontend/src/test/fixtures.js` may stay as is).
- [ ] **Step 4: Checkpoint.** New tests PASS; full Python and frontend suites PASS.

---

### Task 8: Graceful shutdown

**Files:**
- Modify: `xss_detector/server.py` (`serve`)
- Test: `tests/test_shutdown.py`

**Interfaces:**
- Produces: `install_shutdown_handlers(httpd: HardenedServer) -> None` registering `signal.SIGTERM` (and `SIGINT`) so that the handler starts a **new thread** running `httpd.shutdown` (calling it inline from the thread that runs `serve_forever` would deadlock). `serve()` calls it, runs `serve_forever()`, then `server_close()` (which waits for in-flight request threads because `block_on_close` is true) and logs the shutdown.

- [ ] **Step 1: Write failing tests** (Windows cannot deliver a catchable SIGTERM to a child, so test in-process with `signal.raise_signal(signal.SIGTERM)` and restore the previous handlers in `tearDown`):
  - `serve_forever` running in a background thread, `install_shutdown_handlers(httpd)` called from the main thread, `signal.raise_signal(signal.SIGTERM)` -> the serve thread ends within 5 s.
  - **In-flight request completes:** start a request whose handler is held open (use a `Handler` subclass with a `threading.Event` gate in `do_POST` or a slow `_scan`), raise SIGTERM, release the gate, and assert the client still receives its full `200` response before `server_close()` returns.
  - a second SIGTERM while shutting down does not raise.
- [ ] **Step 2: Run** `python -m unittest tests.test_shutdown` -> FAIL.
- [ ] **Step 3: Implement** as specified above.
- [ ] **Step 4: Checkpoint.** `python -m unittest tests.test_shutdown` PASS; full Python suite PASS.

---

### Task 9: Scan-cost guard

**Files:**
- Test: `tests/test_performance.py`
- Modify (only if a case fails): `xss_detector/detector.py` or `xss_detector/server.py`

**Interfaces:**
- Consumes: `HybridDetector().scan(text) -> dict` and `server.MAX_BODY`.

Measured before planning (256 KB inputs, single scan, this machine): worst case `0.17 s` (`"<" * 262144`); the rest `0.06-0.14 s`. The budget below is generous on purpose, so the test guards against a future catastrophic-regex regression rather than machine speed.

- [ ] **Step 1: Write the test.** One `unittest` case per adversarial input, each scanning a string of `256 * 1024` characters within a `2.0` s budget (`time.perf_counter`): `"<"` run; `"<a "` repeated; `"<script"` repeated; `"<img " + "onerror=" * n`; `'"'` run; `"javascript:"` repeated; `"%25"` repeated; `"&amp;"` repeated; `"\\u003c"` repeated; a run of spaces; `"onload "` repeated; `"="` run; `"("` run; plus a six-layer percent-encoded payload. Also one end-to-end case: `POST /api/scan` with a max-size body through `make_server` returns within the budget.
- [ ] **Step 2: Run** `python -m unittest tests.test_performance`. **Expected: PASS** (per the measurements above).
- [ ] **Step 3: If any case exceeds the budget**, stop and report the input and timing to the user before changing anything: fixing a rule can change detection results and requires `python -m xss_detector evaluate` and a benchmark comparison. The alternative is a scan-length cap returning `413` from `server.py`; the user picks. Do not weaken the budget to make a slow case pass.
- [ ] **Step 4: Checkpoint.** Full Python suite PASS.

---

### Task 10: Docker, Render, CI, docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `render.yaml`, `.gitattributes`, `.github/workflows/ci.yml`
- Modify: `README.md` (new "Deploying" section; the Layout block; the API table's health row)
- Test: `tests/test_deploy_files.py`

**Interfaces:**
- Consumes: env vars from Task 1; `/api/health` from Task 7; `python -m xss_detector serve` reading `HOST`/`PORT`.

Decisions to implement (no Docker locally, so static tests plus CI prove the files):
- `Dockerfile`: `FROM python:3.12-slim`; `ENV HOST=0.0.0.0 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1`; create and switch to a non-root user (`USER app`); `COPY xss_detector/ xss_detector/` and `COPY reports/benchmark.json reports/benchmark.json`; no `pip install`; `EXPOSE 8000`; `HEALTHCHECK` running `python -c` that calls `urllib.request.urlopen("http://127.0.0.1:" + PORT + "/api/health", timeout=3)` (raises on `503`, so the check fails); `CMD ["python", "-m", "xss_detector", "serve"]`.
- `.dockerignore`: `node_modules`, `frontend`, `data`, `docs`, `tests`, `.git`, `.github`, `**/__pycache__`, `**/*.pyc`, `.tmp`, `reports/benchmark.md`.
- `render.yaml`: one `web` service, `runtime: docker`, `healthCheckPath: /api/health`, env `TRUSTED_PROXY_HOPS=1`, `LOG_FORMAT=json`, `ENABLE_HSTS=1`; do not set `PORT` (Render injects it).
- `.gitattributes`: `xss_detector/static/app.js -text` and `* text=auto` only if it does not touch the bundle, so line endings cannot make the freshness check flap.
- `ci.yml` (on `push` and `pull_request`, `ubuntu-latest`): setup Python 3.12 and Node 24; `python -m unittest discover -s tests -t .`; `npm --prefix frontend ci`; `npm --prefix frontend test`; `npm --prefix frontend audit`; `npm --prefix frontend run build` then `git diff --exit-code xss_detector/static/app.js` (the freshness check); `docker build -t xss-detector .`.
- README "Deploying": the env-var table from the spec, the Render steps (push to GitHub, "New Blueprint Instance"), `TRUSTED_PROXY_HOPS` guidance (`1` on Render; on other platforms inspect `X-Forwarded-For` before choosing, and a wrong value either merges all users into one bucket or lets clients spoof identity), the per-instance rate-limit caveat, and the `429`/`503` behaviour.

- [ ] **Step 1: Write failing tests** in `tests/test_deploy_files.py` (plain text assertions, no YAML library): `Dockerfile` contains `FROM python:3.12`, a `USER` line that is not `root`, `HEALTHCHECK`, `HOST=0.0.0.0`, `CMD`, and no `pip install`; `.dockerignore` lists `node_modules`, `data`, `tests`; `render.yaml` contains `runtime: docker`, `healthCheckPath: /api/health`, `TRUSTED_PROXY_HOPS`, `LOG_FORMAT`, `ENABLE_HSTS`, and not `PORT`; `ci.yml` contains each command listed above including `git diff --exit-code xss_detector/static/app.js` and `docker build`; every file the Dockerfile `COPY`s exists in the repo (`xss_detector/model.json`, `reports/benchmark.json`); README mentions every env var name and `TRUSTED_PROXY_HOPS`.
- [ ] **Step 2: Run** `python -m unittest tests.test_deploy_files` -> FAIL.
- [ ] **Step 3: Create the five files and the README section** per the decisions above.
- [ ] **Step 4: Checkpoint.** `python -m unittest tests.test_deploy_files` PASS; full Python suite PASS. Note in the report that `docker build` itself is unverified locally and is proven by the first CI run.

---

### Task 11: End-to-end smoke and final checks

**Files:**
- Test: `tests/test_deploy_smoke.py`

**Interfaces:**
- Consumes: everything above, through the real CLI in a subprocess.

- [ ] **Step 1: Write the test.** Start `python -m xss_detector serve` with `subprocess.Popen` and env `{PORT: <free port>, HOST: "127.0.0.1", LOG_FORMAT: "json", RATE_LIMIT: "60", RATE_BURST: "3", TRUSTED_PROXY_HOPS: "0"}` (merged over `os.environ`, capturing stderr). Poll `/api/health` until `200` (10 s max). Assert: the app honours `PORT` and `HOST`; `POST /api/scan` x3 -> `200` then `429` with `Retry-After`; `/api/health` and `/app.js` still `200`; response headers include the CSP, `Permissions-Policy`, `X-Request-Id`; `GET /app.js` with `Accept-Encoding: gzip` returns gzip; the captured stderr lines that start with `{` all parse as JSON and at least one has `status == 429`; no stderr line contains a test marker sent in a POST body. `tearDown` calls `proc.terminate()` and `wait(timeout=10)`.
- [ ] **Step 2: Run** `python -m unittest tests.test_deploy_smoke` -> PASS (all implementation exists by now; if it fails, fix the owning task's code, not the smoke test).
- [ ] **Step 3: Final checkpoint.** `python -m unittest discover -s tests -t .` PASS (68 original + all new tests); `npm --prefix frontend test` PASS (435 + the one new test); `npm --prefix frontend run build:check` exit 0 and `xss_detector/static/app.js` unchanged (compare SHA-256 before/after: this plan does not touch the frontend source); manually run `python -m xss_detector serve`, open `http://127.0.0.1:8000`, confirm the site loads and hammering `/scanner` submissions eventually shows the UI error text for a `429`; stop the server.

---

## Handoff note (not a task)

Deploying needs the folder to become a git repository pushed to GitHub. That is the user's decision and is intentionally not part of this plan: after Task 11, ask whether to `git init`, add a `.gitignore` (`node_modules/`, `frontend/.tmp/`, `__pycache__/`), commit, and push, and then walk through the Render blueprint deploy.
