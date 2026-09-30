"""Per-client token-bucket rate limiting, plus a spoof-resistant way to find the client's IP."""

from __future__ import annotations

import ipaddress
import threading
import time
from collections import OrderedDict
from typing import Callable


class TokenBucketLimiter:
    """One bucket per key: `burst` tokens, refilled at `rate_per_minute / 60` per second.

    State is in memory and per process. The table holds at most `max_clients` keys; the least recently seen
    key is dropped first, so an attacker who rotates identities cannot make it grow without bound.
    """

    def __init__(self, rate_per_minute: float, burst: int, max_clients: int = 4096,
                 clock: Callable[[], float] = time.monotonic):
        self._per_second = rate_per_minute / 60.0
        self._burst = float(burst)
        self._max_clients = max_clients
        self._clock = clock
        self._buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()  # key -> (tokens, last seen)
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._buckets)

    def allow(self, key: str, cost: float = 1.0) -> tuple[bool, float]:
        """Take `cost` tokens. Returns (allowed, seconds until enough tokens exist); denials take nothing."""
        with self._lock:
            now = self._clock()
            tokens, seen = self._buckets.pop(key, (self._burst, now))
            tokens = min(self._burst, tokens + (now - seen) * self._per_second)
            allowed = tokens >= cost
            retry_after = 0.0
            if allowed:
                tokens -= cost
            else:
                retry_after = (cost - tokens) / self._per_second
            self._buckets[key] = (tokens, now)  # re-inserting moves the key to the "most recent" end
            while len(self._buckets) > self._max_clients:
                self._buckets.popitem(last=False)
            return allowed, retry_after


def client_ip(peer: str, forwarded_for: str | None, hops: int) -> str:
    """The client's address. With `hops` trusted proxies in front, the client is the `hops`-th entry from the
    right of X-Forwarded-For: each trusted proxy appends the address it saw, so entries to the left of that are
    whatever the client claimed and are ignored. Anything unusable falls back to the socket peer."""
    if hops <= 0 or not forwarded_for:
        return peer
    entries = [part.strip() for part in forwarded_for.split(",")]
    if len(entries) < hops:
        return peer
    candidate = entries[-hops]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return peer
