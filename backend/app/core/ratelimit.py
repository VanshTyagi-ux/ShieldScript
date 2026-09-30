"""Per-client rate limiting, reusing the stdlib server's token-bucket limiter and spoof-resistant client-IP
lookup (`xss_detector/ratelimit.py`) so both servers share one tested implementation and policy.

`limiter` is a module-level singleton, read fresh on every request rather than captured at middleware
construction, so tests can swap or disable it without rebuilding the app or its middleware stack.
`limiter = None` means unlimited - the same convention the stdlib server uses for the test servers that
don't attach one. The test suite disables it by default (see tests/__init__.py) because the existing tests
share one app/TestClient and make far more requests than a real client's burst allowance.
"""

from __future__ import annotations

import json
import math

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings
from app.core.repo import ensure_repo_importable

ensure_repo_importable()

from xss_detector.ratelimit import TokenBucketLimiter, client_ip  # noqa: E402

# What one request costs, relative to API_V1_PREFIX; GET listing/catalog endpoints are cheap reads, POST
# endpoints run the detector or the sanitizer. An unlisted route (e.g. GET /payloads/{id}, or a 404) costs
# the default. /health is exempt (checked separately, never charged).
COSTS = {
    ("GET", "/rules"): 0.25,
    ("GET", "/benchmark"): 0.25,
    ("GET", "/payloads"): 0.25,
    ("GET", "/payloads/facets"): 0.25,
    ("POST", "/scan"): 1.0,
    ("POST", "/submit"): 1.0,
    ("POST", "/sanitize"): 1.0,
}
DEFAULT_COST = 1.0
DRAIN_FACTOR = 4  # matches BodyLimitMiddleware: draining bounded to a small multiple of a typical body
_BODY_METHODS = {"POST", "PUT", "PATCH"}

limiter: TokenBucketLimiter | None = TokenBucketLimiter(settings.RATE_LIMIT, settings.RATE_BURST)


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, prefix: str) -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or limiter is None or scope["path"] == f"{self.prefix}/health":
            await self.app(scope, receive, send)
            return

        route = scope["path"][len(self.prefix):] if scope["path"].startswith(self.prefix) else scope["path"]
        cost = COSTS.get((scope["method"], route), DEFAULT_COST)
        key = self._client(scope)
        allowed, retry_after = limiter.allow(key, cost)
        if allowed:
            await self.app(scope, receive, send)
            return

        if scope["method"] in _BODY_METHODS:
            await self._drain(receive)
        wait = max(1, math.ceil(retry_after))
        body = json.dumps({"error": f"Rate limit exceeded; retry in {wait} s"}).encode()
        await send({"type": "http.response.start", "status": 429,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode()),
                                (b"retry-after", str(wait).encode())]})
        await send({"type": "http.response.body", "body": body})

    def _client(self, scope: Scope) -> str:
        peer = scope["client"][0] if scope.get("client") else "unknown"
        headers = dict(scope["headers"])
        forwarded = headers.get(b"x-forwarded-for")
        return client_ip(peer, forwarded.decode("latin-1") if forwarded is not None else None, settings.TRUSTED_PROXY_HOPS)

    async def _drain(self, receive: Receive) -> None:
        # Unread body data on a rejected request can reset the connection instead of delivering our 429;
        # same reasoning and cap as BodyLimitMiddleware._reject.
        remaining = DRAIN_FACTOR * settings.MAX_BODY
        while remaining > 0:
            event = await receive()
            if event["type"] != "http.request":
                break
            remaining -= len(event.get("body", b""))
            if not event.get("more_body", False):
                break
