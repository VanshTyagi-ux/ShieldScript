"""Output-encoding helpers. Detection is a second line of defence; always
encode untrusted data for the context it is rendered in."""

from __future__ import annotations

import html
from urllib.parse import urlsplit

_SAFE_SCHEMES = {"http", "https", "mailto"}


def escape_html(value) -> str:
    """Encode for HTML text and quoted-attribute contexts."""
    return html.escape("" if value is None else str(value), quote=True).replace("`", "&#96;")


def safe_url(value, allowed=_SAFE_SCHEMES) -> str | None:
    """Return the URL if its scheme is allow-listed (or it is relative), else None."""
    url = "".join(ch for ch in str(value).strip() if ch not in "\t\r\n\x00")
    if not url:
        return None
    scheme = urlsplit(url).scheme.lower()
    if scheme and scheme not in allowed:
        return None
    return url
