# Production Deployment Hardening - Design

Date: 2026-09-28
Status: Draft for review

## 1. Intent

Make the XSS Detector safe to host publicly on a PaaS (Render, Railway or Fly.io) so strangers can use it.
This is a hardening and packaging job, not a feature job. The detector, the API shapes and the React UI do
not change. The stdlib-only, no-pip runtime is kept.

Chosen approach: **A - harden the existing stdlib server** (`ThreadingHTTPServer` + `Handler`). A production
WSGI server (B) or a FastAPI/Flask rewrite (C) were considered and rejected: they add runtime dependencies and
a large diff for a ~240-line server that already works. B stays available later as an isolated step.

Success criteria:

- The app runs from a Docker image configured only by environment variables, and passes a platform health check.
- A single client cannot exhaust the server through request volume, slow connections or oversized input.
- Behind a PaaS proxy, limits apply per real client, and a client cannot spoof its identity.
- One `git push` deploys it; CI blocks a stale bundle, failing tests or a failing image build.
- All 68 existing Python tests and 435 frontend tests stay green.

## 2. Findings that shape the design

- `serve()` uses `ThreadingHTTPServer`; there is no shared mutable state and a body cap (`MAX_BODY` = 256 KB)
  with a clean 413 path already exists.
- `address_string()` returns the socket peer, which behind a PaaS proxy is the proxy for every visitor.
- Every scan runs regexes and ML on up to 256 KB of attacker-chosen text: a denial-of-service surface.
- `Cache-Control: no-store` is sent on everything, including the ~330 KB `app.js`.
- The folder is not a git repository; PaaS deploys need one.

## 3. Configuration (`xss_detector/config.py`, new)

A dataclass read once from the environment. CLI flags override it. With no variables set, behaviour is
unchanged.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` (image sets `0.0.0.0`) | bind address |
| `PORT` | `8000` | listen port (PaaS injects `$PORT`) |
| `LOG_LEVEL` | `INFO` | log level |
| `LOG_FORMAT` | `text` | `text` or `json` |
| `MAX_BODY` | `262144` | request size cap (existing constant) |
| `RATE_LIMIT` | `60` | sustained requests per minute per client on `/api/*` |
| `RATE_BURST` | `20` | burst allowance |
| `TRUSTED_PROXY_HOPS` | `0` | proxies to trust for client IP |
| `ENABLE_HSTS` | off | send `Strict-Transport-Security` |

Invalid values (non-numeric, negative) fail fast at start-up with a clear message.

## 4. Rate limiting (`xss_detector/ratelimit.py`, new)

- Per-client token bucket held in memory behind a lock.
- Applies to every `/api/*` request. `POST /api/scan` and `POST /api/submit` cost 1 token; cheap GET endpoints
  (`/api/rules`, `/api/benchmark`) cost less. Exempt: the HTML shell, `/app.js`, `/api/health`.
- Over the limit: `429`, `Retry-After` header, `{"error": ...}` body.
- Memory is bounded: the table is capped (a few thousand clients) and evicts the oldest idle entries.
- Client identity: `TRUSTED_PROXY_HOPS=0` uses the socket peer. With `n`, the client is the nth entry from the
  right of `X-Forwarded-For`, so a forged header cannot change identity. A missing or malformed header falls
  back to the socket peer.
- State is per process. Multiple instances would need a shared store; documented, not built.

## 5. Server hardening (`xss_detector/server.py`)

- **Scan cost:** first a test feeds adversarial input (long runs of `<`, nested encodings, max-size bodies) and
  asserts a time budget. If a rule is slow it is fixed; if the cost is inherent, a scan-length cap returns a clear
  `413`. The measurement decides.
- **Slow clients:** handler socket timeout (about 15 s). Concurrent-connection cap that answers `503` with
  `Retry-After` when full. Fixed constants, not env vars: 15 s timeout, 64 concurrent connections. Request
  threads are non-daemon so shutdown waits for in-flight requests; the 15 s timeout bounds that wait.
- **Caching:** `app.js` gets an `ETag` (hash of the file) and `Cache-Control: no-cache` (revalidate, fast `304`),
  and is gzip-compressed once per file version (cached, recomputed if the file changes, so `npm run dev` keeps
  working) and served compressed when the client accepts it. The shell and API
  keep `no-store`.
- **Headers:** the CSP is unchanged. Add `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS when
  `ENABLE_HSTS` is set.
- **Health:** `/api/health` gains a `bundle` flag and returns `503` when the frontend bundle is missing, so a
  bad deploy receives no traffic.
- **Logging:** one line per request (method, path, status, duration, client IP, request id). An incoming
  `X-Request-Id` is honoured only if it matches `[A-Za-z0-9._-]{1,64}`, otherwise one is generated. Request bodies
  and query strings are never logged (the route only), because both can carry user input. Format follows
  `LOG_FORMAT`.
- **Shutdown:** `SIGTERM` finishes in-flight requests, then exits cleanly.

## 6. Packaging and deployment

- **Dockerfile:** `python:3.12-slim`, non-root user, no pip dependencies, `HOST=0.0.0.0`, `HEALTHCHECK` calling
  `/api/health`. It uses the committed `xss_detector/static/app.js` (no Node stage), and includes `model.json`
  and `reports/benchmark.json` but not the large payload lists (`.dockerignore`).
- **`render.yaml`:** Docker runtime, `healthCheckPath: /api/health`, `TRUSTED_PROXY_HOPS=1`, `LOG_FORMAT=json`,
  `ENABLE_HSTS=1`. Railway and Fly.io get the same variable list in the README; their config files wait until
  one is chosen.
- **CI (GitHub Actions):** Python tests; `npm ci` + Vitest; a bundle-freshness check (rebuild the frontend and
  fail if `xss_detector/static/app.js` differs); `npm audit`; Docker build.
- **Git:** the folder must become a git repository pushed to GitHub before deploying. Done only when the user
  agrees.

## 7. Testing

Written before the code (TDD). New tests: config parsing and validation; limiter token maths, eviction and
`X-Forwarded-For` hop selection (including a spoofed header); the `429` and `503` paths; ETag, `304` and gzip;
health `503` when the bundle is missing; request id handling; `SIGTERM` shutdown; the adversarial timing test.
Docker build is verified locally only if Docker is installed; otherwise CI proves it.

## 8. Existing tests affected

No existing test asserts on `Cache-Control`, so none is expected to change. The new caching behaviour gets its
own tests (section 7).

## 9. Out of scope

Accounts or login, a database, a shared multi-instance rate limiter, custom domain and TLS management (the
platform provides HTTPS), a WAF, and a WSGI or framework migration.

## 10. Risks and open items

- Rate limiting is per instance; horizontal scaling weakens it.
- If the adversarial test finds a slow rule, the fix may change detection results; that would be reported and
  re-benchmarked rather than hidden.
- A wrong `TRUSTED_PROXY_HOPS` either lumps all users into one bucket (too low) or lets clients spoof identity
  (too high). The README states the correct value per platform.
