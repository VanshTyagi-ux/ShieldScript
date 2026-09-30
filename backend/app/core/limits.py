"""Request-body size limit, applied before the body is parsed.

Pure ASGI middleware. A scan runs regexes over the whole text, so an unbounded body is a cheap way to burn
CPU. Same behaviour as the stdlib server: a body needs a Content-Length (411), and one over the limit gets a
413 with a JSON error. The rejected body is drained (up to DRAIN_FACTOR x the limit) before answering,
because replying and closing with unread request data can reset the connection, and the client would see a
network error instead of the 413.
"""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

DRAIN_FACTOR = 4
_BODY_METHODS = {"POST", "PUT", "PATCH"}


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body: int) -> None:
        self.app = app
        self.max_body = max_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return

        raw = dict(scope["headers"]).get(b"content-length")
        try:
            length = int(raw) if raw is not None else None
        except ValueError:
            length = None
        if length is None:
            await self._reject(scope, receive, send, 411, "Content-Length header required", drain=0)
        elif length < 0 or length > self.max_body:
            await self._reject(scope, receive, send, 413, f"Body must be at most {self.max_body} bytes", drain=length)
        else:
            await self.app(scope, receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send, status: int, message: str, drain: int) -> None:
        remaining = min(max(drain, 0), DRAIN_FACTOR * self.max_body)
        while remaining > 0:
            event: Message = await receive()
            if event["type"] != "http.request":
                break
            remaining -= len(event.get("body", b""))
            if not event.get("more_body", False):
                break
        body = json.dumps({"error": message}).encode()
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
