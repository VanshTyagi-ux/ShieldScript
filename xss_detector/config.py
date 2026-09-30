"""Server settings, read once from environment variables (CLI flags override them)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Callable, Mapping, TypeVar

T = TypeVar("T")

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}


class ConfigError(ValueError):
    """An environment variable has an unusable value; the message names it."""


@dataclass(frozen=True)
class Config:
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "INFO"
    log_format: str = "text"
    max_body: int = 256 * 1024
    rate_limit: int = 60  # sustained requests per minute per client on /api/*
    rate_burst: int = 20
    trusted_proxy_hops: int = 0
    enable_hsts: bool = False

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Config":
        env = os.environ if environ is None else environ
        defaults = cls()

        def read(name: str, default: T, parse: Callable[[str], T]) -> T:
            if name not in env:
                return default
            try:
                return parse(env[name])
            except ConfigError:
                raise
            except ValueError as exc:
                raise ConfigError(f"{name}={env[name]!r} is invalid: {exc}") from None

        return cls(
            host=read("HOST", defaults.host, _nonempty),
            port=read("PORT", defaults.port, lambda v: _int_between(v, 1, 65535)),
            log_level=read("LOG_LEVEL", defaults.log_level, _log_level),
            log_format=read("LOG_FORMAT", defaults.log_format, lambda v: _choice(v, ("text", "json"))),
            max_body=read("MAX_BODY", defaults.max_body, lambda v: _int_between(v, 1, None)),
            rate_limit=read("RATE_LIMIT", defaults.rate_limit, lambda v: _int_between(v, 1, None)),
            rate_burst=read("RATE_BURST", defaults.rate_burst, lambda v: _int_between(v, 1, None)),
            trusted_proxy_hops=read("TRUSTED_PROXY_HOPS", defaults.trusted_proxy_hops,
                                    lambda v: _int_between(v, 0, None)),
            enable_hsts=read("ENABLE_HSTS", defaults.enable_hsts, _boolean),
        )


DEFAULT_CONFIG = Config()


def _nonempty(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be empty")
    return value.strip()


def _int_between(value: str, low: int, high: int | None) -> int:
    number = int(value.strip())  # ValueError for "", "abc"
    if number < low or (high is not None and number > high):
        bound = f"at least {low}" if high is None else f"between {low} and {high}"
        raise ValueError(f"must be {bound}")
    return number


def _choice(value: str, options: tuple[str, ...]) -> str:
    lowered = value.strip().lower()
    if lowered not in options:
        raise ValueError("must be one of " + ", ".join(options))
    return lowered


def _log_level(value: str) -> str:
    name = value.strip().upper()
    if name not in logging.getLevelNamesMapping():
        raise ValueError("must be a logging level such as INFO or DEBUG")
    return name


def _boolean(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in _TRUE:
        return True
    if lowered in _FALSE:
        return False
    raise ValueError("must be one of 1, true, yes, on, 0, false, no, off")
