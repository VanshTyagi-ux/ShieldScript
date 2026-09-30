"""HTML sanitizing (allow-list, via nh3) plus a report of what was removed.

Safety comes from nh3 alone: the string it returns is the only thing a caller should store or render. The
report is informational. nh3 does not say what it removed, so it is derived by scanning the input and the
output with the small tokenizer below and comparing them. That scan is not a full HTML5 parser, so on
malformed markup the report can differ from what a browser (or nh3) makes of it; it never affects `clean`.

Why a hand-written scanner and not html.parser: Python's html.parser takes tens of seconds on a few hundred KB of
`<a ` / `<!--` / `<a b="` repeated, which would turn the report into a denial-of-service hole. Everything below
is linear in the input (bounded regexes, and each step moves past what it consumed).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal

# -- policy (the project's rich-text design, docs/superpowers/specs/2026-09-28-richtext-sanitizer-design.md) ----
ALLOWED_TAGS = frozenset({"a", "b", "i", "em", "strong", "p", "br", "ul", "ol", "li", "blockquote", "code", "pre",
                          "h1", "h2", "h3", "h4", "img"})
ALLOWED_ATTRIBUTES = {"a": frozenset({"href", "title"}), "img": frozenset({"src", "alt"})}
URL_SCHEMES = frozenset({"http", "https", "mailto"})  # javascript:, data:, vbscript: etc. are dropped
CLEAN_CONTENT_TAGS = frozenset({"script", "style"})  # removed together with what is inside them
LINK_REL = "noopener noreferrer"  # added to every kept link

# Attributes whose value is a URL: if one of these is allowed on a tag but disappears, its URL was rejected.
_URL_ATTRIBUTES = frozenset({"href", "src", "action", "formaction", "xlink:href", "srcset", "poster", "data",
                             "background", "cite", "ping"})
# Elements whose content is text, not markup: `<script>if (a<b)</script>` contains no tag `b`.
_RAW_TEXT_TAGS = frozenset({"script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"})

# on + at least 3 letters (onclick, onerror, onend...). A label only: "one" or "on" are ordinary attribute names.
_EVENT_HANDLER = re.compile(r"on[a-z]{3,}\Z")

MAX_REPORT_ITEMS = 100  # per list; totals are always exact
_MAX_NAME_LENGTH = 64  # names come from the input; keep the report small


class SanitizerUnavailable(RuntimeError):
    """nh3 is not installed. Callers must refuse the request, never pass the input through unsanitized."""


Reason = Literal["event_handler", "unsafe_url", "tag_not_allowed", "attribute_not_allowed"]


@dataclass
class Report:
    removed_tags: list[dict] = field(default_factory=list)  # {name, count, content_removed}
    removed_attributes: list[dict] = field(default_factory=list)  # {tag, name, count, reason}
    comments_removed: int = 0
    total_tags_removed: int = 0
    total_attributes_removed: int = 0
    truncated: bool = False  # True if a list above was cut at MAX_REPORT_ITEMS


@dataclass
class Outcome:
    clean: str
    changed: bool  # clean != input. Noisy: re-serialising (`<br/>` -> `<br>`, an added rel=) counts too.
    report: Report


# -- the scanner --------------------------------------------------------------------------------------------
@dataclass
class Markup:
    tags: Counter = field(default_factory=Counter)  # start-tag name -> count
    attrs: Counter = field(default_factory=Counter)  # (tag, attribute) -> count
    comments: int = 0


_START_TAG = re.compile(r"<([A-Za-z][^\s/>]*+)")
# The inside of a start tag, up to the first unquoted `<` or `>`. Possessive quantifiers: no backtracking.
_TAG_BODY = re.compile(r"""(?:[^<>"']++|"[^"]*+"|'[^']*+')*+""")
_ATTRIBUTE = re.compile(r"""([^\s"'<>/=]++)(?:\s*+=\s*+(?:"[^"]*+"|'[^']*+'|[^\s"'<>]*+))?""")
_RAW_TEXT_END = {name: re.compile("</" + name, re.IGNORECASE) for name in _RAW_TEXT_TAGS}


def scan_markup(html: str) -> Markup:
    """Count the start tags, attributes and comments in `html`. Linear time; never raises on odd input."""
    out, n, pos = Markup(), len(html), 0
    while pos < n:
        i = html.find("<", pos)
        if i == -1:
            break
        if html.startswith("<!--", i):  # comment: runs to `-->` or, if unterminated, to the end
            out.comments += 1
            end = html.find("-->", i + 4)
            pos = n if end == -1 else end + 3
        elif html.startswith(("<!", "<?", "</"), i):  # doctype, CDATA, end tag, bogus comment: up to the next `>`
            end = html.find(">", i)
            pos = n if end == -1 else end + 1
        else:
            match = _START_TAG.match(html, i)
            if match is None:  # a lone `<` is just text
                pos = i + 1
                continue
            name = match.group(1).lower()
            body = _TAG_BODY.match(html, match.end())
            out.tags[name] += 1
            for attribute in _ATTRIBUTE.finditer(html, body.start(), body.end()):
                out.attrs[(name, attribute.group(1).lower())] += 1
            pos = body.end() + 1 if body.end() < n and html[body.end()] == ">" else body.end()
            if name == "plaintext":
                pos = n  # everything after <plaintext> is text
            elif name in _RAW_TEXT_TAGS:
                close = _RAW_TEXT_END[name].search(html, pos)
                pos = n if close is None else close.start()
    return out


# -- sanitizing ---------------------------------------------------------------------------------------------
def _nh3():
    try:
        import nh3
    except ImportError as exc:
        raise SanitizerUnavailable("nh3 is not installed") from exc
    return nh3


def _attribute_reason(tag: str, attribute: str) -> Reason:
    if _EVENT_HANDLER.match(attribute):
        return "event_handler"
    if tag in ALLOWED_TAGS and attribute in ALLOWED_ATTRIBUTES.get(tag, ()) and attribute in _URL_ATTRIBUTES:
        return "unsafe_url"  # the attribute is allowed here, so it was its value (the URL scheme) that failed
    return "attribute_not_allowed" if tag in ALLOWED_TAGS else "tag_not_allowed"


def _short(name: str) -> str:
    return name if len(name) <= _MAX_NAME_LENGTH else name[:_MAX_NAME_LENGTH] + "…"


def build_report(before: Markup, after: Markup) -> Report:
    """What is in the input's markup but not in the sanitized output's."""
    gone_tags = before.tags - after.tags
    gone_attrs = before.attrs - after.attrs
    tags = sorted(gone_tags.items(), key=lambda kv: (-kv[1], kv[0]))
    attrs = sorted(gone_attrs.items(), key=lambda kv: (-kv[1], kv[0]))
    return Report(
        removed_tags=[{"name": _short(name), "count": count, "content_removed": name in CLEAN_CONTENT_TAGS}
                      for name, count in tags[:MAX_REPORT_ITEMS]],
        removed_attributes=[{"tag": _short(tag), "name": _short(attr), "count": count,
                             "reason": _attribute_reason(tag, attr)}
                            for (tag, attr), count in attrs[:MAX_REPORT_ITEMS]],
        comments_removed=before.comments,  # every comment is stripped
        total_tags_removed=sum(gone_tags.values()),
        total_attributes_removed=sum(gone_attrs.values()),
        truncated=len(tags) > MAX_REPORT_ITEMS or len(attrs) > MAX_REPORT_ITEMS,
    )


def sanitize(raw: str) -> Outcome:
    """Sanitize `raw` (an HTML fragment). Raises SanitizerUnavailable if nh3 is missing."""
    clean = _nh3().clean(
        raw,
        tags=set(ALLOWED_TAGS),
        # "*" = attributes allowed on every tag. nh3 defaults it to {lang, title}; an empty set makes the
        # allow-list exactly ALLOWED_ATTRIBUTES.
        attributes={**{tag: set(attrs) for tag, attrs in ALLOWED_ATTRIBUTES.items()}, "*": set()},
        url_schemes=set(URL_SCHEMES),
        link_rel=LINK_REL,
        strip_comments=True,
        clean_content_tags=set(CLEAN_CONTENT_TAGS),
    )
    return Outcome(clean=clean, changed=clean != raw, report=build_report(scan_markup(raw), scan_markup(clean)))
